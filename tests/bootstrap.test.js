const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBootstrap() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "addon", "bootstrap.js"),
    "utf8"
  );
  const context = {
    console,
    ChromeUtils: {},
    Services: {},
    APP_SHUTDOWN: 2,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.Zotero = {
    Prefs: { get: () => "" },
    logError(error) { throw error; },
  };
  context.ReaderToolShortcutsCore = {
    TOOLS: [],
    isEditableTarget: () => false,
    toolForEvent: () => null,
    activateTool: () => false,
    getReaderEventWindows(reader) {
      return [
        reader._iframeWindow,
        reader._internalReader?._primaryView?._iframeWindow,
      ].filter(Boolean);
    },
  };
  return context;
}

function fakeWindow() {
  const listeners = new Map();
  return {
    document: { querySelector: () => null },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    emit(type) { listeners.get(type)?.(); },
    has(type) { return listeners.has(type); },
  };
}

test("Reader window unload removes its keydown listener and record", () => {
  const context = loadBootstrap();
  const win = fakeWindow();
  context.ReaderToolShortcutsGeneration = 1;
  context.ReaderToolShortcutsShuttingDown = false;

  context.rtsAttachToWindow(win, win.document, 1);
  assert.equal(win.has("keydown"), true);
  assert.equal(context.ReaderToolShortcutsWindows.length, 1);

  win.emit("unload");
  assert.equal(win.has("keydown"), false);
  assert.equal(context.ReaderToolShortcutsWindows.length, 0);
});

test("shutdown generation change cancels a pending Reader attachment", async () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const reader = {
    _waitForReader: () => ready,
    _initPromise: Promise.resolve(),
    _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: fakeWindow() } },
  };
  context.ReaderToolShortcutsGeneration = 1;
  context.ReaderToolShortcutsShuttingDown = false;

  const attachment = context.rtsAttachToReader(reader, 1);
  context.ReaderToolShortcutsShuttingDown = true;
  context.ReaderToolShortcutsGeneration = 2;
  resolveReady();
  await attachment;

  assert.equal(context.ReaderToolShortcutsWindows.length, 0);
  assert.equal(outer.has("keydown"), false);
});

test("initialized Reader attaches both outer and PDF event windows", async () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const pdf = fakeWindow();
  const reader = {
    _waitForReader: async () => {},
    _initPromise: Promise.resolve(),
    _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: pdf } },
  };
  context.ReaderToolShortcutsGeneration = 3;
  context.ReaderToolShortcutsShuttingDown = false;

  await context.rtsAttachToReader(reader, 3);

  assert.equal(context.ReaderToolShortcutsWindows.length, 2);
  assert.equal(outer.has("keydown"), true);
  assert.equal(pdf.has("keydown"), true);
});
