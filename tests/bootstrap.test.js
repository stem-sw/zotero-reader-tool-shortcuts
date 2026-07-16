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
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
      if (!listeners.get(type)?.size) listeners.delete(type);
    },
    emit(type) {
      for (const handler of [...(listeners.get(type) || [])]) handler();
    },
    has(type) { return Boolean(listeners.get(type)?.size); },
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

test("waits for PDF view initialization before attaching its event window", async () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const pdf = fakeWindow();
  let resolveView;
  const view = {
    _iframeWindow: null,
    initializedPromise: new Promise(resolve => { resolveView = resolve; }),
  };
  const reader = {
    _waitForReader: async () => {},
    _initPromise: Promise.resolve(),
    _iframeWindow: outer,
    _internalReader: { _primaryView: view },
  };
  context.ReaderToolShortcutsGeneration = 4;
  context.ReaderToolShortcutsShuttingDown = false;

  let settled = false;
  const attachment = context.rtsAttachToReader(reader, 4).then(() => {
    settled = true;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(settled, false);
  assert.equal(pdf.has("keydown"), false);

  view._iframeWindow = pdf;
  resolveView();
  await attachment;

  assert.equal(pdf.has("keydown"), true);
});

test("does not attach a pending PDF view after its Reader unloads", async () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const pdf = fakeWindow();
  let resolveView;
  const view = {
    _iframeWindow: null,
    initializedPromise: new Promise(resolve => { resolveView = resolve; }),
  };
  const reader = {
    _waitForReader: async () => {},
    _initPromise: Promise.resolve(),
    _iframeWindow: outer,
    _internalReader: { _primaryView: view },
  };
  context.ReaderToolShortcutsGeneration = 5;
  context.ReaderToolShortcutsShuttingDown = false;

  const attachment = context.rtsAttachToReader(reader, 5);
  await new Promise(resolve => setImmediate(resolve));
  outer.emit("unload");
  view._iframeWindow = pdf;
  resolveView();
  await attachment;

  assert.equal(context.ReaderToolShortcutsReaders.length, 0);
  assert.equal(pdf.has("keydown"), false);
});

test("handles destroyed Reader state without rejecting view attachment", async () => {
  const context = loadBootstrap();
  context.Zotero.logError = () => {};
  const reader = {};
  Object.defineProperty(reader, "_internalReader", {
    get() { throw new Error("dead object"); },
  });

  await assert.doesNotReject(
    context.rtsAttachCurrentViews(reader, {}, 6)
  );
});

test("reattaches to a replacement PDF view after webviewerloaded", async () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const firstPdf = fakeWindow();
  const reader = {
    _waitForReader: async () => {},
    _initPromise: Promise.resolve(),
    _iframeWindow: outer,
    _internalReader: {
      _primaryView: {
        _iframeWindow: firstPdf,
        initializedPromise: Promise.resolve(),
      },
    },
  };
  context.ReaderToolShortcutsGeneration = 5;
  context.ReaderToolShortcutsShuttingDown = false;
  await context.rtsAttachToReader(reader, 5);
  assert.equal(firstPdf.has("keydown"), true);

  const replacementPdf = fakeWindow();
  let resolveReplacement;
  reader._internalReader._primaryView = {
    _iframeWindow: replacementPdf,
    initializedPromise: new Promise(resolve => { resolveReplacement = resolve; }),
  };
  outer.emit("webviewerloaded");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replacementPdf.has("keydown"), false);

  resolveReplacement();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replacementPdf.has("keydown"), true);
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
