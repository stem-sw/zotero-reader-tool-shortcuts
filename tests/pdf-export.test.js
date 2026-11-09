const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const core = require("../src/core.js");

// Minimal native-export control flow; the installed Zotero worker is also
// exercised separately in an isolated Zotero profile during release checks.
const nativeFixture = `
async function embedFixture(annotation, fontResource, fontEmbedder) {
  let chars = await fontEmbedder.embedChars(annotation.comment, fontResource);
  return chars;
}

function exportText(annotation, chars) {
  let fontSize = annotation.position.fontSize;
  let lineHeightMultiplier = 1.2;
  let width = 100;
  let height = 70;
  let maxLines, lines;
  for (let n = 0; n < 20; n++) {
    maxLines = Math.floor(height / (fontSize * lineHeightMultiplier));
    lines = calculateLines(chars, fontSize, width);
    if (lines.length > maxLines && fontSize > 4) { fontSize -= .5; continue; }
    break;
  }
  const refY = 100;
  const baselines = [];
  for (let i = 0; i < lines.length; i++) {
    let lineY = refY - (i + 1) * fontSize * lineHeightMultiplier;
    baselines.push(lineY);
  }
  return { fontSize, baselines, lines: lines.map(line => line.map(c => c.char).join('')) };
}`;

function exporter(source) {
  const context = vm.createContext({ calculateLines: chars => [chars] });
  vm.runInContext(source, context);
  return context.exportText;
}

const chars = text => Array.from(text, char => ({ char }));

test("PDF export preserves font size, explicit blank lines and requested baseline spacing", () => {
  const run = exporter(core.patchPDFWorkerSource(nativeFixture));
  const comment = "A\n\nB";
  const position = {
    fontSize: 12, rtsLineHeight: 2, rtsBaseline: .9, rtsLineLengths: [1, 0, 1],
  };
  position.rtsLayoutKey = core.textLayoutKey(comment, position);
  const result = run({ comment, position }, chars(comment));
  assert.equal(result.fontSize, 12);
  assert.deepEqual(Array.from(result.lines), ["A", "", "B"]);
  assert.ok(Math.abs(result.baselines[0] - 89.2) < 1e-9);
  assert.ok(Math.abs(result.baselines[1] - result.baselines[0] + 24) < 1e-9);
  assert.ok(Math.abs(result.baselines[2] - result.baselines[1] + 24) < 1e-9);
});

test("stored browser wrapping handles Korean and supplementary Unicode characters", () => {
  const run = exporter(core.patchPDFWorkerSource(nativeFixture));
  const comment = "가나😀A";
  const position = { fontSize: 5, rtsLineHeight: 1.5, rtsLineLengths: [2, 2] };
  position.rtsLayoutKey = core.textLayoutKey(comment, position);
  const result = run({ comment, position }, chars(comment));
  assert.deepEqual(Array.from(result.lines), ["가나", "😀A"]);
  assert.equal(result.baselines[0] - result.baselines[1], 7.5);
});

test("same-length edits in older Zotero clients invalidate cached wraps", () => {
  const run = exporter(core.patchPDFWorkerSource(nativeFixture));
  const position = { fontSize: 6, rtsLineHeight: 1.8, rtsLineLengths: [2, 2] };
  position.rtsLayoutKey = core.textLayoutKey("AB\nCD", position);
  const comment = "ABC\nD";
  const result = run({ comment, position }, chars(comment));
  assert.deepEqual(Array.from(result.lines), ["ABC", "D"]);
});

test("older spacing annotations without saved wraps retain manual line breaks", () => {
  const run = exporter(core.patchPDFWorkerSource(nativeFixture));
  const result = run({ comment: "first\n\nlast", position: { fontSize: 6, rtsLineHeight: 1.5 } }, chars("first\n\nlast"));
  assert.deepEqual(Array.from(result.lines), ["first", "", "last"]);
});

test("unmodified annotations keep the original exporter behavior", () => {
  const annotation = { position: { fontSize: 12 } };
  const actual = exporter(core.patchPDFWorkerSource(nativeFixture))(annotation, chars("normal"));
  const expected = exporter(nativeFixture)(annotation, chars("normal"));
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
});

test("exporter source mismatch is reported instead of silently changing PDF layout", () => {
  assert.throws(() => core.patchPDFWorkerSource("unrecognized worker"), /Unsupported Zotero PDF exporter/);
  assert.throws(() => core.patchPDFWorkerSource(nativeFixture + "\nlet lineHeightMultiplier = 1.2;"), /Unsupported/);
});


test("font embedding receives drawable characters without newline control glyphs", async () => {
  const context = vm.createContext({ calculateLines: chars => [chars] });
  vm.runInContext(core.patchPDFWorkerSource(nativeFixture), context);
  let input;
  await context.embedFixture({ comment: "A\n한글\r\nB", position: { rtsLineHeight: 1.5 } }, {}, {
    embedChars(text) { input = text; return chars(text); },
  });
  assert.equal(input, "A한글B");
});

test("document worker handles the opaque origin used by a Blob worker", () => {
  const context = vm.createContext({ location: { origin: "null" }, URL });
  vm.runInContext(core.patchPDFWorkerSource(nativeFixture + '\nvar origin = location.origin;'), context);
  assert.equal(context.origin, undefined);
});


test("PDF font subsets include the missing glyph and all previously used characters", () => {
  const fixture = nativeFixture + `
    const fonts = [];
    function textOperators(rotationMatrix, currentFont, fontSize) {
      const stream = [];
      let matrix = rotationMatrix.slice();
      matrix[4] = "0.000";
      stream.push(\`/\${currentFont} \${fontSize} Tf\`);
      return { matrix, stream };
    }
    class FontEmbedder {
      constructor({ standardFontProvider }) { this._fonts = []; }
    }
    function usedGlyphs(font, ttfFont) {
      const glyphIDsUsed = [];
      let unicodeCmap = ttfFont.cmap.unicode.codeMap;
      for (let key in unicodeCmap) {
        glyphIDsUsed.push(ttfFont.characterToGlyph(Number(key)));
      }
      return glyphIDsUsed;
    }
  `;
  const context = vm.createContext({});
  vm.runInContext(core.patchPDFWorkerSource(fixture, {
    fontName: "/TestFont", fileName: "test.ttf", unicodeIntervals: [[32, 126]],
  }), context);
  const glyphs = context.usedGlyphs({ charsUsed: ["A", "한"] }, {
    cmap: { unicode: { codeMap: { 65: 1, 66: 2, 54620: 3 } } },
    characterToGlyph: code => ({ 65: 1, 66: 2, 54620: 3 })[code],
  });
  assert.deepEqual(Array.from(glyphs), [0, 1, 3]);
  const operators = context.textOperators([Math.cos(Math.PI / 2), 1, -1, 0], "/F0", 12);
  assert.equal(operators.matrix[0], "0.00000000");
  assert.equal(operators.stream[0], "/F0 12 Tf");
});
