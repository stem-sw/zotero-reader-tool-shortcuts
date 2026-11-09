(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ReaderToolShortcutsCore = api;
})(this, function () {
  "use strict";

  const TOOLS = [
    {
      id: "note",
      pref: "noteShortcut",
      selector: ".toolbar-button.note",
      defaultShortcut: "Alt+Digit3",
    },
    {
      id: "text",
      pref: "textShortcut",
      selector: ".toolbar-button.text",
      defaultShortcut: "Alt+Digit4",
    },
    {
      id: "area",
      pref: "areaShortcut",
      selector: ".toolbar-button.area",
      defaultShortcut: "Alt+Digit5",
    },
  ];

  const TEXT_FONT_SIZE_STEPS = [3, 4, 5, 6, 8, 10, 12, 14, 18, 24, 36, 48, 64, 72, 96, 144, 192];
  const DEFAULT_TEXT_TOOL = { color: "#2ea8e5", size: 6 };
  const DEFAULT_TEXT_MAX_WIDTH = 900;
  const DEFAULT_TEXT_LINE_HEIGHT = 1.8;

  const MODIFIER_KEYS = new Set([
    "Alt",
    "AltGraph",
    "Control",
    "Meta",
    "OS",
    "Shift",
  ]);

  function shortcutFromEvent(event) {
    if (!event || MODIFIER_KEYS.has(event.key) || !event.code) {
      return null;
    }

    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(event.code);
    return parts.join("+");
  }

  function formatCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`;
    const labels = {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Escape: "Esc",
      Equal: "=",
      Minus: "-",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backquote: "`",
    };
    return labels[code] || code;
  }

  function formatShortcut(shortcut) {
    if (!shortcut) return "지정 안 함";
    const parts = shortcut.split("+");
    parts[parts.length - 1] = formatCode(parts[parts.length - 1]);
    return parts.join("+");
  }

  function eventMatchesShortcut(event, shortcut) {
    if (!shortcut || !event || event.isComposing || event.repeat) {
      return false;
    }
    return shortcutFromEvent(event) === shortcut;
  }

  function toolForEvent(event, shortcuts) {
    for (const tool of TOOLS) {
      if (eventMatchesShortcut(event, shortcuts[tool.pref])) {
        return tool;
      }
    }
    return null;
  }

  function activateTool(doc, tool) {
    if (!doc || !tool) return false;
    const button = doc.querySelector(tool.selector);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function normalizeTextToolDefaults(defaults = {}) {
    const color = typeof defaults.color === "string" && /^#[0-9a-f]{6}$/i.test(defaults.color)
      ? defaults.color.toLowerCase()
      : DEFAULT_TEXT_TOOL.color;
    const requestedSize = Number(defaults.size);
    const size = TEXT_FONT_SIZE_STEPS.includes(requestedSize)
      ? requestedSize
      : DEFAULT_TEXT_TOOL.size;
    return { color, size };
  }

  function applyTextToolDefaults(reader, defaults) {
    const textTool = reader?._internalReader?._tools?.text;
    if (!textTool) return false;
    Object.assign(textTool, normalizeTextToolDefaults(defaults));
    return true;
  }

  function activateBlackTextColor(reader, event, toolbarDoc, cloneForReader) {
    if (
      !event ||
      event.code !== "Digit9" ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.metaKey
    ) {
      return false;
    }
    const internalReader = reader?._internalReader;
    const textButton = toolbarDoc?.querySelector?.(".toolbar-button.text");
    if (
      !textButton?.classList?.contains?.("active") ||
      typeof internalReader?.setTool !== "function"
    ) {
      return false;
    }
    const toReader = typeof cloneForReader === "function" ? cloneForReader : value => value;
    internalReader.setTool(toReader({ color: "#000000" }));
    return true;
  }

  function normalizeTextMaxWidth(value) {
    const width = Number(value);
    return Number.isFinite(width) && width >= 100 && width <= 2000
      ? Math.round(width)
      : DEFAULT_TEXT_MAX_WIDTH;
  }

  function normalizeTextLineHeight(value) {
    const height = Number(value);
    return Number.isFinite(height) && height >= 0.5 && height <= 3
      ? Math.round(height * 10) / 10
      : DEFAULT_TEXT_LINE_HEIGHT;
  }

  function textLayoutKey(comment, position) {
    const text = (comment || "").replace(/\r\n?/g, "\n");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    }
    const rect = position.rects?.[0];
    const width = rect ? (rect[2] - rect[0]).toFixed(3) : "";
    return [text.length, hash >>> 0, width, position.fontSize, position.rtsLineHeight].join(":");
  }

  function createTextWidthAdjuster(nativeAdjust, maxWidth, getPageRect, cloneForReader) {
    const normalizedMaxWidth = normalizeTextMaxWidth(maxWidth);
    const toReader = typeof cloneForReader === "function" ? cloneForReader : value => value;
    const callNativeWithGeneratedArguments = function (context, annotation, options) {
      return nativeAdjust.call(context, toReader(annotation), toReader(options));
    };
    const wrapped = function (annotation, options = {}) {
      if (!options.adjustSingleLineWidth || !options.enableSingleLineMaxWidth) {
        return nativeAdjust.call(this, annotation, options);
      }

      const sourceRect = annotation?.position?.rects?.[0];
      const sourceFontSize = Number(annotation?.position?.fontSize);
      const sourceIsMultiline = sourceRect && Number.isFinite(sourceFontSize)
        && sourceRect[3] - sourceRect[1] >= 2 * sourceFontSize;
      if (sourceIsMultiline) {
        return nativeAdjust.call(this, annotation, options);
      }

      const pageRect = typeof getPageRect === "function" ? getPageRect(annotation) : null;
      const rotation = ((Number(annotation?.position?.rotation) || 0) % 360 + 360) % 360;
      if (
        rotation === 0 &&
        Array.isArray(pageRect) && pageRect.length === 4 && sourceRect &&
        pageRect.every(value => Number.isFinite(value))
      ) {
        const borderPadding = 5;
        const availablePageWidth = pageRect[2] - pageRect[0] - 2 * borderPadding;
        const probeAnnotation = {
          ...annotation,
          position: JSON.parse(JSON.stringify(annotation.position)),
        };
        const probeRect = probeAnnotation.position.rects[0];
        const sourceWidth = probeRect[2] - probeRect[0];
        probeRect[0] = pageRect[0] + borderPadding;
        probeRect[2] = probeRect[0] + sourceWidth;

        const measuredOptions = {
          ...options,
          enableSingleLineMaxWidth: false,
        };
        const measured = callNativeWithGeneratedArguments(
          this,
          probeAnnotation,
          measuredOptions
        );
        const measuredRect = measured?.rects?.[0];
        if (measuredRect && availablePageWidth > 0) {
          const measuredWidth = measuredRect[2] - measuredRect[0];
          const targetWidth = Math.min(measuredWidth, normalizedMaxWidth, availablePageWidth);
          if (Number.isFinite(targetWidth) && targetWidth > 0) {
            const fittedAnnotation = {
              ...annotation,
              position: JSON.parse(JSON.stringify(annotation.position)),
            };
            const fittedRect = fittedAnnotation.position.rects[0];
            fittedRect[2] = fittedRect[0] + targetWidth;
            const fittedOptions = {
              ...options,
              adjustSingleLineWidth: false,
              enableSingleLineMaxWidth: false,
            };
            return callNativeWithGeneratedArguments(
              this,
              fittedAnnotation,
              fittedOptions
            );
          }
        }
      }

      const uncappedOptions = {
        ...options,
        enableSingleLineMaxWidth: false,
      };
      const uncapped = callNativeWithGeneratedArguments(
        this,
        annotation,
        uncappedOptions
      );
      const rect = uncapped?.rects?.[0];
      const fontSize = Number(annotation?.position?.fontSize);
      const isMultiline = rect && Number.isFinite(fontSize)
        && rect[3] - rect[1] >= 2 * fontSize;
      if (!rect || isMultiline || rect[2] - rect[0] <= normalizedMaxWidth) {
        return uncapped;
      }

      const cappedAnnotation = {
        ...annotation,
        position: JSON.parse(JSON.stringify(uncapped)),
      };
      const cappedRect = cappedAnnotation.position.rects[0];
      cappedRect[2] = cappedRect[0] + normalizedMaxWidth;
      const cappedOptions = {
        ...options,
        adjustSingleLineWidth: false,
        enableSingleLineMaxWidth: false,
      };
      return callNativeWithGeneratedArguments(
        this,
        cappedAnnotation,
        cappedOptions
      );
    };
    wrapped._rtsTextMaxWidth = normalizedMaxWidth;
    return wrapped;
  }


  function patchPDFWorkerSource(source, font) {
    const patches = [
      [/let lineHeightMultiplier\s*=\s*1\.2;/g, `
        const rtsHeight = Number(annotation.position.rtsLineHeight);
        const rtsCustom = Number.isFinite(rtsHeight) && rtsHeight >= 0.5 && rtsHeight <= 3;
        let lineHeightMultiplier = rtsCustom ? rtsHeight : 1.2;
        const rtsChars = chars.filter(c => c.char !== '\\n' && c.char !== '\\r');
        const rtsLengths = annotation.position.rtsLineLengths;
        const rtsCurrentLayout = rtsCustom && annotation.position.rtsLayoutKey
          === (${textLayoutKey})(annotation.comment, annotation.position);
        const rtsStoredLines = rtsCurrentLayout && Array.isArray(rtsLengths)
          && rtsLengths.every(n => Number.isInteger(n) && n >= 0)
          && rtsLengths.reduce((sum, n) => sum + n, 0) === rtsChars.length;
        const rtsMakeLines = () => {
          if (rtsStoredLines) {
            let offset = 0;
            return rtsLengths.map(n => rtsChars.slice(offset, offset += n));
          }
          const lines = [];
          let offset = 0;
          for (const paragraph of annotation.comment.replace(/\\r\\n?/g, '\\n').split('\\n')) {
            const count = Array.from(paragraph).length;
            const part = rtsChars.slice(offset, offset += count);
            lines.push(...(part.length ? calculateLines(part, fontSize, width) : [[]]));
          }
          return lines;
        };
      `],
      [/lines\s*=\s*calculateLines\(chars, fontSize, width\);/g,
        'lines = rtsCustom ? rtsMakeLines() : calculateLines(chars, fontSize, width);'],
      [/if \(lines\.length > maxLines && fontSize > 4\)/g,
        'if (!rtsCustom && lines.length > maxLines && fontSize > 4)'],
      [/let lineY = refY - \(i \+ 1\) \* fontSize \* lineHeightMultiplier;/g,
        `let lineY = refY - (rtsCurrentLayout && Number.isFinite(annotation.position.rtsBaseline)
          ? annotation.position.rtsBaseline : lineHeightMultiplier) * fontSize
          - i * fontSize * lineHeightMultiplier;`],
    ];
    patches.push([
      /let chars = await fontEmbedder\.embedChars\(annotation\.comment, fontResource\);/g,
      `const rtsHasSpacing = annotation.position.rtsLineHeight >= 0.5 && annotation.position.rtsLineHeight <= 3;
       let chars = await fontEmbedder.embedChars(rtsHasSpacing
         ? annotation.comment.replace(/[\\r\\n]/g, '') : annotation.comment, fontResource);
       if (rtsHasSpacing && !chars) throw new Error('A text annotation contains a character without an embeddable font.');`,
    ]);
    if (font) patches.push(
      [/let matrix = rotationMatrix\.slice\(\);\s*matrix\[4\]\s*=/g,
        'let matrix = rotationMatrix.map(n => n.toFixed(8)); matrix[4] ='],
      [/stream\.push\(`\/\$\{currentFont\} \$\{fontSize\} Tf`\);/g,
        'stream.push(`${currentFont} ${fontSize} Tf`);'],
    );
    // The native exporter embeds every glyph on each annotation. Restrict the
    // subset to accumulated used characters so Korean exports stay responsive.
    if (font) patches.push([
      /let unicodeCmap = ttfFont\.cmap\.unicode\.codeMap;\s*for \(let key in unicodeCmap\)/g,
      'glyphIDsUsed.push(0); for (let key of font.charsUsed.map(char => char.codePointAt(0)))',
    ]);
    if (font) patches.push([
      /constructor\(\{\s*standardFontProvider\s*\}\)\s*\{\s*this\._fonts = \[\];/g,
      `constructor({ standardFontProvider }) {
        this._fonts = [];
        if (!fonts.some(f => f.fileName === ${JSON.stringify(font.fileName)})) fonts.push(${JSON.stringify(font)});`,
    ]);
    for (const [pattern, replacement] of patches) {
      if ((source.match(pattern) || []).length !== 1) {
        throw new Error("Unsupported Zotero PDF exporter: cannot preserve text line spacing safely.");
      }
      source = source.replace(pattern, replacement);
    }
    // Blob workers have an opaque origin. ONNX Runtime (loaded by Zotero's
    // document worker) must not pass the string "null" as a URL base.
    return source.replace(/(?<![\w.])location\.origin\b/g,
      '(location.origin === "null" ? undefined : location.origin)');
  }

  function duplicateToolForShortcut(shortcuts, currentPref, shortcut) {
    if (!shortcut) return null;
    return TOOLS.find(
      tool => tool.pref !== currentPref && shortcuts[tool.pref] === shortcut
    ) || null;
  }

  function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
      )
    );
  }

  function getReaderEventWindows(reader) {
    if (!reader) return [];
    const windows = [
      reader._iframeWindow,
      reader._internalReader?._primaryView?._iframeWindow,
    ].filter(Boolean);
    return [...new Set(windows)];
  }

  return {
    TOOLS,
    shortcutFromEvent,
    formatShortcut,
    eventMatchesShortcut,
    toolForEvent,
    activateTool,
    TEXT_FONT_SIZE_STEPS,
    DEFAULT_TEXT_TOOL,
    DEFAULT_TEXT_MAX_WIDTH,
    DEFAULT_TEXT_LINE_HEIGHT,
    normalizeTextLineHeight,
    textLayoutKey,
    patchPDFWorkerSource,
    normalizeTextToolDefaults,
    applyTextToolDefaults,
    activateBlackTextColor,
    normalizeTextMaxWidth,
    createTextWidthAdjuster,
    duplicateToolForShortcut,
    isEditableTarget,
    getReaderEventWindows,
  };
});
