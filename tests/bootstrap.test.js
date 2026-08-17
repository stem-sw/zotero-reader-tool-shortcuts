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
    normalizeTextToolDefaults: defaults => defaults,
    applyTextToolDefaults: () => false,
    normalizeTextMaxWidth: value => Number(value) || 900,
    createTextWidthAdjuster: (adjuster, width) => Object.assign(
      (annotation, options) => adjuster(annotation, options),
      { _rtsTextMaxWidth: width }
    ),
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
          normalizeTextToolDefaults: defaults => defaults,
          applyTextToolDefaults: () => false,
          normalizeTextMaxWidth: value => Number(value) || 900,
          createTextWidthAdjuster: (adjuster, width) => Object.assign(
            (annotation, options) => adjuster(annotation, options),
            { _rtsTextMaxWidth: width }
          ),
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
    Prefs: { get: () => undefined },
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
          normalizeTextToolDefaults: defaults => defaults,
          applyTextToolDefaults: () => false,
          normalizeTextMaxWidth: value => Number(value) || 900,
          createTextWidthAdjuster: (adjuster, width) => Object.assign(
            (annotation, options) => adjuster(annotation, options),
            { _rtsTextMaxWidth: width }
          ),
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

test("Reader scan does not overwrite later manual changes when settings are unchanged", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const internalReader = { _tools: { text: { color: "#ffd400", size: 14 } } };
  context.Zotero.Prefs.get = key => key.endsWith("textColor") ? "#2ea8e5" : 6;
  context.Zotero.Reader._readers = [{
    _iframeWindow: outer,
    _internalReader: internalReader,
  }];
  let applications = 0;
  context.ReaderToolShortcutsCore.applyTextToolDefaults = (reader, defaults) => {
    applications++;
    Object.assign(reader._internalReader._tools.text, defaults);
    return true;
  };
  activate(context, 41);

  context.rtsScanReaders(41);
  internalReader._tools.text.color = "#ff6666";
  internalReader._tools.text.size = 10;
  context.rtsScanReaders(41);

  assert.equal(applications, 1);
  assert.deepEqual(internalReader._tools.text, { color: "#ff6666", size: 10 });
});

test("Reader scan reapplies text defaults after a preference change", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const internalReader = { _tools: { text: { color: "#ffd400", size: 14 } } };
  const prefs = { textColor: "#2ea8e5", textSize: 6 };
  context.Zotero.Prefs.get = key => prefs[key.split(".").pop()];
  context.Zotero.Reader._readers = [{
    _iframeWindow: outer,
    _internalReader: internalReader,
  }];
  let applications = 0;
  context.ReaderToolShortcutsCore.applyTextToolDefaults = (reader, defaults) => {
    applications++;
    Object.assign(reader._internalReader._tools.text, defaults);
    return true;
  };
  activate(context, 42);

  context.rtsScanReaders(42);
  prefs.textColor = "#a28ae5";
  prefs.textSize = 18;
  context.rtsScanReaders(42);

  assert.equal(applications, 2);
  assert.deepEqual(internalReader._tools.text, { color: "#a28ae5", size: 18 });
});

test("resolves the current PDF page viewBox for text-width fitting", () => {
  const context = loadBootstrap();
  const viewBox = [0, 0, 600, 800];
  const reader = {
    _internalReader: {
      _primaryView: {
        _iframeWindow: {
          PDFViewerApplication: {
            pdfViewer: { _pages: [{ viewport: { viewBox } }] },
          },
        },
      },
    },
  };

  assert.equal(
    context.rtsGetTextPageRect(reader, { position: { pageIndex: 0 } }),
    viewBox
  );
  assert.equal(context.rtsGetTextPageRect(reader, { position: { pageIndex: 1 } }), null);
});

test("Reader scan patches Zotero's text position adjuster with width 900", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const original = () => ({ rects: [[0, 0, 300, 10]] });
  const manager = { _adjustTextAnnotationPosition: original };
  context.Zotero.Prefs.get = key => key.endsWith("textMaxWidth") ? 900 : "";
  context.Zotero.Reader._readers = [{
    _iframeWindow: outer,
    _internalReader: { _annotationManager: manager },
  }];
  activate(context, 43);

  context.rtsScanReaders(43);

  assert.notEqual(manager._adjustTextAnnotationPosition, original);
  assert.equal(manager._adjustTextAnnotationPosition._rtsTextMaxWidth, 900);
});

test("text-width patch clones generated arguments into the Reader window", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const original = () => ({ rects: [[0, 0, 300, 10]] });
  const manager = { _adjustTextAnnotationPosition: original };
  let cloneForReader;
  context.Components = {
    utils: {
      cloneInto(value, target) {
        return { value, target };
      },
    },
  };
  context.ReaderToolShortcutsCore.createTextWidthAdjuster = (
    adjuster,
    width,
    getPageRect,
    clone
  ) => {
    cloneForReader = clone;
    return Object.assign(
      (annotation, options) => adjuster(annotation, options),
      { _rtsTextMaxWidth: width }
    );
  };
  const reader = {
    _iframeWindow: outer,
    _internalReader: { _annotationManager: manager },
  };

  context.rtsPatchTextWidth(reader, 900);

  assert.equal(typeof cloneForReader, "function");
  const value = { position: {} };
  const cloned = cloneForReader(value);
  assert.equal(cloned.value, value);
  assert.equal(cloned.target, outer);
});

test("restoring text width patches reinstates Zotero's native adjuster", () => {
  const context = loadBootstrap();
  const original = () => ({ rects: [[0, 0, 300, 10]] });
  const manager = { _adjustTextAnnotationPosition: original };
  const reader = { _internalReader: { _annotationManager: manager } };

  context.rtsPatchTextWidth(reader, 900);
  assert.notEqual(manager._adjustTextAnnotationPosition, original);

  context.rtsRestoreTextWidthPatches();

  assert.equal(manager._adjustTextAnnotationPosition, original);
  assert.equal(context.ReaderToolShortcutsTextWidthPatches.length, 0);
});

test("Reader scan restores and forgets a closed Reader's text width patch", () => {
  const context = loadBootstrap();
  const original = () => ({ rects: [[0, 0, 300, 10]] });
  const manager = { _adjustTextAnnotationPosition: original };
  const reader = {
    _iframeWindow: fakeWindow(),
    _internalReader: { _annotationManager: manager },
  };
  context.Zotero.Prefs.get = key => key.endsWith("textMaxWidth") ? 900 : "";
  context.Zotero.Reader._readers = [reader];
  activate(context, 44);

  context.rtsScanReaders(44);
  assert.notEqual(manager._adjustTextAnnotationPosition, original);

  context.Zotero.Reader._readers = [];
  context.rtsScanReaders(44);

  assert.equal(manager._adjustTextAnnotationPosition, original);
  assert.equal(context.ReaderToolShortcutsTextWidthPatches.length, 0);
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
