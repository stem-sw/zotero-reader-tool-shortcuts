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
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.Zotero = {
    Prefs: { get: () => "" },
    Reader: { _readers: [] },
    logError(error) { throw error; },
  };
  context.ReaderToolShortcutsCore = {
    TOOLS: [],
    isEditableTarget: () => false,
    toolForEvent: () => null,
    activateTool: () => false,
  };
  context.ReaderToolShortcutsSetInterval = setInterval;
  context.ReaderToolShortcutsClearInterval = clearInterval;
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
    emit(type, event) {
      for (const handler of [...(listeners.get(type) || [])]) handler(event);
    },
    count(type) { return listeners.get(type)?.size || 0; },
    has(type) { return Boolean(listeners.get(type)?.size); },
  };
}

function activate(context, generation = 1) {
  context.ReaderToolShortcutsGeneration = generation;
  context.ReaderToolShortcutsShuttingDown = false;
  return generation;
}

test("application shutdown stops the Reader scan timer", () => {
  const context = loadBootstrap();
  let clearedTimer = null;
  context.ReaderToolShortcutsClearInterval = timer => { clearedTimer = timer; };
  context.ReaderToolShortcutsScanTimer = 88;
  context.ReaderToolShortcutsGeneration = 8;
  context.ReaderToolShortcutsShuttingDown = false;

  context.shutdown({}, context.APP_SHUTDOWN);

  assert.equal(clearedTimer, 88);
  assert.equal(context.ReaderToolShortcutsScanTimer, null);
  assert.equal(context.ReaderToolShortcutsShuttingDown, true);
});

test("Reader scan timer restarts for a new generation", () => {
  const context = loadBootstrap();
  let nextTimer = 90;
  const created = [];
  const cleared = [];
  context.ReaderToolShortcutsSetInterval = (callback, ms) => {
    const timer = nextTimer++;
    created.push({ timer, callback, ms });
    return timer;
  };
  context.ReaderToolShortcutsClearInterval = timer => { cleared.push(timer); };
  activate(context, 9);
  context.rtsStartReaderScan(9);

  activate(context, 10);
  context.rtsStartReaderScan(10);

  assert.equal(created.length, 2);
  assert.deepEqual(cleared, [90]);
  assert.equal(context.ReaderToolShortcutsScanTimer, 91);
});

test("Reader scan timer starts once and stops cleanly", () => {
  const context = loadBootstrap();
  let intervalCallback = null;
  let intervalMs = null;
  let setCount = 0;
  let clearedTimer = null;
  context.ReaderToolShortcutsSetInterval = (callback, ms) => {
    setCount++;
    intervalCallback = callback;
    intervalMs = ms;
    return 77;
  };
  context.ReaderToolShortcutsClearInterval = timer => { clearedTimer = timer; };
  activate(context, 22);

  context.rtsStartReaderScan(22);
  context.rtsStartReaderScan(22);

  assert.equal(setCount, 1);
  assert.equal(context.ReaderToolShortcutsScanTimer, 77);
  assert.equal(intervalMs, 250);
  assert.equal(typeof intervalCallback, "function");

  context.rtsStopReaderScan();
  assert.equal(clearedTimer, 77);
  assert.equal(context.ReaderToolShortcutsScanTimer, null);
});

test("Reader event scanning uses the current active generation", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  context.Zotero.Reader._readers = [{ _iframeWindow: outer }];
  activate(context, 31);

  context.rtsHandleReaderEvent();

  assert.equal(outer.has("keydown"), true);
});

test("startup cancelled during Zotero initialization performs no registrations", async () => {
  const context = loadBootstrap();
  let resolveInitialization;
  const initializationPromise = new Promise(resolve => {
    resolveInitialization = resolve;
  });
  let scriptLoadCount = 0;
  let paneRegisterCount = 0;
  const zotero = {
    initializationPromise,
    PreferencePanes: {
      register: async () => { paneRegisterCount++; return "pane"; },
    },
    Reader: { _readers: [], registerEventListener() {} },
    debug() {},
  };
  context.ChromeUtils = {
    importESModule(url) {
      if (url === "resource://gre/modules/Timer.sys.mjs") {
        return { setInterval, clearInterval };
      }
      return { Zotero: zotero };
    },
  };
  context.Services = {
    scriptloader: { loadSubScript: () => { scriptLoadCount++; } },
  };

  const startup = context.startup({ id: "plugin", rootURI: "file:///plugin/" });
  context.shutdown({}, context.APP_SHUTDOWN);
  resolveInitialization();
  await startup;

  assert.equal(scriptLoadCount, 0);
  assert.equal(paneRegisterCount, 0);
});

test("startup cancelled during preference registration installs no Reader handler", async () => {
  const context = loadBootstrap();
  let resolvePane;
  const panePromise = new Promise(resolve => { resolvePane = resolve; });
  let paneRegisterStarted = false;
  let readerRegisterCount = 0;
  let paneUnregisterCount = 0;
  const zotero = {
    initializationPromise: Promise.resolve(),
    PreferencePanes: {
      register: () => {
        paneRegisterStarted = true;
        return panePromise;
      },
      unregister: () => { paneUnregisterCount++; },
    },
    Reader: {
      _readers: [],
      registerEventListener: () => { readerRegisterCount++; },
    },
    debug() {},
  };
  context.ChromeUtils = {
    importESModule(url) {
      if (url === "resource://gre/modules/Timer.sys.mjs") {
        return { setInterval, clearInterval };
      }
      return { Zotero: zotero };
    },
  };
  context.Services = {
    scriptloader: {
      loadSubScript: (url, scope) => {
        scope.ReaderToolShortcutsCore = {
          TOOLS: [],
          isEditableTarget: () => false,
          toolForEvent: () => null,
          activateTool: () => false,
        };
      },
    },
  };

  const startup = context.startup({ id: "plugin", rootURI: "file:///plugin/" });
  for (let attempt = 0; attempt < 5 && !paneRegisterStarted; attempt++) {
    await Promise.resolve();
  }
  assert.equal(paneRegisterStarted, true);
  context.shutdown({}, context.APP_SHUTDOWN);
  resolvePane("pane");
  await startup;

  assert.equal(readerRegisterCount, 0);
  assert.equal(context.ReaderToolShortcutsScanTimer, null);
  assert.equal(paneUnregisterCount, 1);
});

test("startup imports privileged timers when bootstrap globals are absent", async () => {
  const context = loadBootstrap();
  delete context.setInterval;
  delete context.clearInterval;
  let timerImportCount = 0;
  let intervalStartCount = 0;
  const zotero = {
    initializationPromise: Promise.resolve(),
    PreferencePanes: { register: async () => "pane" },
    Reader: { _readers: [], registerEventListener() {} },
    debug() {},
  };
  context.ChromeUtils = {
    importESModule(url) {
      if (url === "chrome://zotero/content/zotero.mjs") return { Zotero: zotero };
      if (url === "resource://gre/modules/Timer.sys.mjs") {
        timerImportCount++;
        return {
          setInterval() { intervalStartCount++; return 101; },
          clearInterval() {},
        };
      }
      throw new Error(`unexpected module: ${url}`);
    },
  };
  context.Services = {
    scriptloader: {
      loadSubScript(url, scope) {
        scope.ReaderToolShortcutsCore = {
          TOOLS: [],
          isEditableTarget: () => false,
          toolForEvent: () => null,
          activateTool: () => false,
        };
      },
    },
  };

  await context.startup({ id: "plugin", rootURI: "file:///plugin/" });

  assert.equal(timerImportCount, 1);
  assert.equal(intervalStartCount, 1);
  assert.equal(context.ReaderToolShortcutsScanTimer, 101);
});

test("Reader scan attaches the current outer and PDF windows", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const pdf = fakeWindow();
  context.Zotero.Reader._readers = [{
    _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: pdf } },
  }];
  activate(context, 21);

  context.rtsScanReaders(21);

  assert.equal(outer.has("keydown"), true);
  assert.equal(pdf.has("keydown"), true);
});

test("a later scan attaches a replacement PDF window", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const firstPdf = fakeWindow();
  const replacementPdf = fakeWindow();
  const reader = {
    _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: firstPdf } },
  };
  context.Zotero.Reader._readers = [reader];
  activate(context, 3);

  context.rtsScanReaders(3);
  reader._internalReader._primaryView = { _iframeWindow: replacementPdf };
  context.rtsScanReaders(3);

  assert.equal(firstPdf.has("keydown"), false);
  assert.equal(replacementPdf.has("keydown"), true);
});

test("repeated scans deduplicate listeners by window identity", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const pdf = fakeWindow();
  context.Zotero.Reader._readers = [{
    _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: pdf } },
  }];
  activate(context, 4);

  context.rtsScanReaders(4);
  context.rtsScanReaders(4);

  assert.equal(outer.count("keydown"), 1);
  assert.equal(pdf.count("keydown"), 1);
  assert.equal(context.ReaderToolShortcutsWindows.length, 2);
});

test("Reader scan tolerates a destroyed Reader wrapper", () => {
  const context = loadBootstrap();
  const reader = {};
  Object.defineProperty(reader, "_iframeWindow", {
    get() { throw new Error("dead object"); },
  });
  context.Zotero.Reader._readers = [reader];
  activate(context, 5);

  assert.doesNotThrow(() => context.rtsScanReaders(5));
  assert.equal(context.ReaderToolShortcutsWindows.length, 0);
});

test("inactive generation prevents scanner attachment", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  context.Zotero.Reader._readers = [{ _iframeWindow: outer }];
  activate(context, 6);
  context.ReaderToolShortcutsShuttingDown = true;

  context.rtsScanReaders(6);

  assert.equal(outer.has("keydown"), false);
});

test("Reader window unload removes its keydown listener and record", () => {
  const context = loadBootstrap();
  const win = fakeWindow();
  activate(context, 7);

  context.rtsAttachToWindow(win, win.document, 7);
  assert.equal(win.has("keydown"), true);
  assert.equal(context.ReaderToolShortcutsWindows.length, 1);

  win.emit("unload");

  assert.equal(win.has("keydown"), false);
  assert.equal(context.ReaderToolShortcutsWindows.length, 0);
});
