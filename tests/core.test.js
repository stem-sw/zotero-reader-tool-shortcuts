const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/core.js");

test("publishes the API on the loadSubScript target scope", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "core.js"),
    "utf8"
  );
  const targetScope = {};
  const context = vm.createContext({ targetScope });

  vm.runInContext(
    `(function (module) { ${source}\n}).call(targetScope, undefined);`,
    context
  );

  assert.equal(typeof targetScope.ReaderToolShortcutsCore, "object");
  assert.equal(targetScope.ReaderToolShortcutsCore.TOOLS.length, 3);
});

function keyEvent(overrides = {}) {
  return {
    key: "n",
    code: "KeyN",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  };
}

test("serializes a shortcut using stable event.code and ordered modifiers", () => {
  assert.equal(
    core.shortcutFromEvent(keyEvent({ ctrlKey: true, altKey: true, shiftKey: true })),
    "Ctrl+Alt+Shift+KeyN"
  );
});

test("does not record a modifier-only key press", () => {
  assert.equal(core.shortcutFromEvent(keyEvent({ key: "Alt", code: "AltLeft", altKey: true })), null);
});

test("formats canonical shortcut values for the preferences UI", () => {
  assert.equal(core.formatShortcut("Alt+KeyN"), "Alt+N");
  assert.equal(core.formatShortcut("Ctrl+Shift+Digit7"), "Ctrl+Shift+7");
  assert.equal(core.formatShortcut("Meta+Space"), "Meta+Space");
});

test("matches the exact modifier combination only", () => {
  assert.equal(core.eventMatchesShortcut(keyEvent({ altKey: true }), "Alt+KeyN"), true);
  assert.equal(core.eventMatchesShortcut(keyEvent({ altKey: true, shiftKey: true }), "Alt+KeyN"), false);
  assert.equal(core.eventMatchesShortcut(keyEvent({ ctrlKey: true }), "Alt+KeyN"), false);
});

test("ignores composing and repeated keyboard events", () => {
  assert.equal(core.eventMatchesShortcut(keyEvent({ altKey: true, isComposing: true }), "Alt+KeyN"), false);
  assert.equal(core.eventMatchesShortcut(keyEvent({ altKey: true, repeat: true }), "Alt+KeyN"), false);
});

test("maps the three requested tools to Zotero 9 toolbar selectors", () => {
  assert.deepEqual(core.TOOLS, [
    { id: "note", pref: "noteShortcut", selector: ".toolbar-button.note", defaultShortcut: "Alt+KeyN" },
    { id: "text", pref: "textShortcut", selector: ".toolbar-button.text", defaultShortcut: "Alt+KeyT" },
    { id: "area", pref: "areaShortcut", selector: ".toolbar-button.area", defaultShortcut: "Alt+KeyA" },
  ]);
});

test("returns the configured tool for a matching keyboard event", () => {
  const shortcuts = {
    noteShortcut: "Ctrl+KeyQ",
    textShortcut: "Alt+KeyT",
    areaShortcut: "Shift+KeyA",
  };
  assert.equal(core.toolForEvent(keyEvent({ ctrlKey: true, code: "KeyQ", key: "q" }), shortcuts).id, "note");
  assert.equal(core.toolForEvent(keyEvent({ shiftKey: true, code: "KeyA", key: "a" }), shortcuts).id, "area");
  assert.equal(core.toolForEvent(keyEvent({ altKey: true, code: "KeyX", key: "x" }), shortcuts), null);
});

test("clicks the requested enabled toolbar button exactly once", () => {
  let clicks = 0;
  const button = { disabled: false, click: () => clicks++ };
  const doc = { querySelector: selector => selector === ".toolbar-button.note" ? button : null };

  assert.equal(core.activateTool(doc, core.TOOLS[0]), true);
  assert.equal(clicks, 1);
});

test("does not activate a missing or disabled toolbar button", () => {
  assert.equal(core.activateTool({ querySelector: () => null }, core.TOOLS[0]), false);
  assert.equal(
    core.activateTool({ querySelector: () => ({ disabled: true, click() {} }) }, core.TOOLS[0]),
    false
  );
});

test("sets configured text annotation color and size", () => {
  const textTool = { type: "text", color: "#ffd400", size: 14 };
  const reader = { _internalReader: { _tools: { text: textTool } } };

  assert.equal(
    core.applyTextToolDefaults(reader, { color: "#ff6666", size: 18 }),
    true
  );
  assert.deepEqual(textTool, { type: "text", color: "#ff6666", size: 18 });
});

test("normalizes invalid text defaults to blue and size 6", () => {
  assert.deepEqual(
    core.normalizeTextToolDefaults({ color: "not-a-color", size: 7 }),
    { color: "#2ea8e5", size: 6 }
  );
});

test("ignores Readers whose text-tool internals are not ready", () => {
  assert.equal(core.applyTextToolDefaults(null, { color: "#2ea8e5", size: 6 }), false);
  assert.equal(
    core.applyTextToolDefaults({ _internalReader: {} }, { color: "#2ea8e5", size: 6 }),
    false
  );
});

test("detects editable targets so typing is never intercepted", () => {
  let selectorUsed = "";
  assert.equal(core.isEditableTarget({ closest: selector => {
    selectorUsed = selector;
    return selector.includes("textarea") ? {} : null;
  } }), true);
  assert.match(selectorUsed, /\[contenteditable\]:not\(\[contenteditable="false"\]\)/);
  assert.equal(core.isEditableTarget({ closest: () => null }), false);
  assert.equal(core.isEditableTarget(null), false);
});

test("finds a duplicate shortcut assigned to another tool", () => {
  const shortcuts = {
    noteShortcut: "Alt+KeyN",
    textShortcut: "Alt+KeyT",
    areaShortcut: "Alt+KeyA",
  };
  assert.equal(
    core.duplicateToolForShortcut(shortcuts, "textShortcut", "Alt+KeyN").id,
    "note"
  );
  assert.equal(
    core.duplicateToolForShortcut(shortcuts, "noteShortcut", "Alt+KeyN"),
    null
  );
  assert.equal(
    core.duplicateToolForShortcut(shortcuts, "noteShortcut", ""),
    null
  );
});

test("returns both the Reader chrome window and PDF primary-view window", () => {
  const outerWindow = { name: "outer" };
  const pdfWindow = { name: "pdf" };
  const reader = {
    _iframeWindow: outerWindow,
    _internalReader: {
      _primaryView: { _iframeWindow: pdfWindow },
    },
  };
  assert.deepEqual(core.getReaderEventWindows(reader), [outerWindow, pdfWindow]);
});

test("deduplicates Reader event windows and ignores unavailable views", () => {
  const sharedWindow = { name: "shared" };
  assert.deepEqual(
    core.getReaderEventWindows({
      _iframeWindow: sharedWindow,
      _internalReader: { _primaryView: { _iframeWindow: sharedWindow } },
    }),
    [sharedWindow]
  );
  assert.deepEqual(core.getReaderEventWindows(null), []);
});
