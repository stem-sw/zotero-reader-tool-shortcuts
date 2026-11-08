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
    Components: { utils: { exportFunction: fn => fn } },
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
    TEXT_FONT_SIZE_STEPS: [3, 4, 5, 6, 8, 10, 12, 14, 18, 24, 36, 48, 64, 72, 96, 144, 192],
    isEditableTarget: () => false,
    toolForEvent: () => null,
    activateTool: () => false,
    activateBlackTextColor: () => false,
    normalizeTextToolDefaults: defaults => defaults,
    applyTextToolDefaults: () => false,
    normalizeTextMaxWidth: value => Number(value) || 900,
    normalizeTextLineHeight: value => Number(value) || 1.2,
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

function fakeToolbarDocument({ hasTextButton = true } = {}) {
  const nodesByID = new Map();
  let textButtonVisible = hasTextButton;
  const textButton = {
    after(node) {
      node.parentNode = { kind: "toolbar" };
      node.previousElementSibling = textButton;
      node._insertedAfterTextButton = true;
    },
  };
  return {
    textButton,
    showTextButton() { textButtonVisible = true; },
    createElement(tagName) {
      const listeners = new Map();
      const node = {
        tagName: tagName.toUpperCase(),
        children: [],
        dataset: {},
        style: {},
        append(...children) { this.children.push(...children); },
        addEventListener(type, handler) { listeners.set(type, handler); },
        dispatch(type) { listeners.get(type)?.({ target: this }); },
        remove() { this.removed = true; nodesByID.delete(this.id); },
        set id(value) { this._id = value; nodesByID.set(value, this); },
        get id() { return this._id; },
      };
      return node;
    },
    querySelector(selector) {
      if (selector === ".toolbar-button.text") {
        return textButtonVisible ? textButton : null;
      }
      if (selector.startsWith("#")) return nodesByID.get(selector.slice(1)) || null;
      return null;
    },
  };
}

test("text-size control is inserted directly after the T tool and is idempotent", () => {
  const context = loadBootstrap();
  const doc = fakeToolbarDocument();
  context.Zotero.Prefs.get = key => key.endsWith("textSize") ? 24 : "#2ea8e5";
  context.ReaderToolShortcutsCore.TEXT_FONT_SIZE_STEPS = [24, 48];
  activate(context, 51);

  const first = context.rtsInstallTextSizeControl({ doc });
  const second = context.rtsInstallTextSizeControl({ doc });

  assert.equal(first, true);
  assert.equal(second, true);
  const control = doc.querySelector("#reader-tool-shortcuts-text-size");
  assert.equal(control._insertedAfterTextButton, true);
  assert.equal(control.children[0].tagName, "SELECT");
  assert.match(control.children[0].style.cssText, /-moz-window-dragging\s*:\s*no-drag/);
  assert.equal(control.children[0].value, "24");
  assert.deepEqual(
    control.children[0].children.map(option => option.value),
    ["24", "48"]
  );
});

test("changing the toolbar size saves the preference and updates every open Reader", () => {
  const context = loadBootstrap();
  const doc = fakeToolbarDocument();
  const prefs = { textColor: "#2ea8e5", textSize: 24 };
  const writes = [];
  context.Zotero.Prefs.get = key => prefs[key.split(".").pop()];
  context.Zotero.Prefs.set = (key, value) => {
    writes.push({ key, value });
    prefs[key.split(".").pop()] = value;
  };
  const first = { _internalReader: { _tools: { text: {} } } };
  const second = { _internalReader: { _tools: { text: {} } } };
  context.Zotero.Reader._readers = [first, second];
  const applied = [];
  context.ReaderToolShortcutsCore.applyTextToolDefaults = (reader, defaults) => {
    applied.push({ reader, defaults });
    Object.assign(reader._internalReader._tools.text, defaults);
    return true;
  };
  activate(context, 52);
  context.rtsInstallTextSizeControl({ doc });

  const select = doc.querySelector("#reader-tool-shortcuts-text-size").children[0];
  select.value = "48";
  select.dispatch("change");

  assert.deepEqual(writes, [{
    key: "extensions.reader-tool-shortcuts.textSize",
    value: 48,
  }]);
  assert.equal(applied.length, 2);
  assert.deepEqual(first._internalReader._tools.text, { color: "#2ea8e5", size: 48 });
  assert.deepEqual(second._internalReader._tools.text, { color: "#2ea8e5", size: 48 });
});

test("changing the toolbar size skips a destroyed Reader and updates the others", () => {
  const context = loadBootstrap();
  context.Zotero.Prefs.get = () => "#2ea8e5";
  context.Zotero.Prefs.set = () => {};
  const destroyed = {};
  Object.defineProperty(destroyed, "_internalReader", {
    get() { throw new Error("dead object"); },
  });
  const live = { _internalReader: { _tools: { text: {} } } };
  context.Zotero.Reader._readers = [destroyed, live];
  context.ReaderToolShortcutsCore.applyTextToolDefaults = (reader, defaults) => {
    Object.assign(reader._internalReader._tools.text, defaults);
    return true;
  };

  assert.doesNotThrow(() => context.rtsSetTextSize(36));
  assert.deepEqual(live._internalReader._tools.text, { color: "#2ea8e5", size: 36 });
});

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

test("plugin shutdown removes text-size controls from open Readers", () => {
  const context = loadBootstrap();
  const doc = fakeToolbarDocument();
  context.Zotero.Prefs.get = key => key.endsWith("textSize") ? 24 : "#2ea8e5";
  context.Zotero.Reader._readers = [{ _iframeWindow: { document: doc } }];
  activate(context, 53);
  context.rtsInstallTextSizeControl({ doc });
  const control = doc.querySelector("#reader-tool-shortcuts-text-size");

  context.shutdown({}, 0);

  assert.equal(control.removed, true);
  assert.equal(doc.querySelector("#reader-tool-shortcuts-text-size"), null);
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

test("renderToolbar event inserts the text-size control beside the T tool", () => {
  const context = loadBootstrap();
  const doc = fakeToolbarDocument();
  context.Zotero.Prefs.get = key => key.endsWith("textSize") ? 18 : "#2ea8e5";
  activate(context, 32);

  context.rtsHandleReaderEvent({ doc });

  const control = doc.querySelector("#reader-tool-shortcuts-text-size");
  assert.equal(control._insertedAfterTextButton, true);
  assert.equal(control.children[0].value, "18");
});

test("renderToolbar uses the plugin area until the T tool becomes available", () => {
  const context = loadBootstrap();
  const doc = fakeToolbarDocument({ hasTextButton: false });
  let fallbackControl = null;
  context.Zotero.Prefs.get = key => key.endsWith("textSize") ? 24 : "#2ea8e5";
  activate(context, 33);

  const installed = context.rtsInstallTextSizeControl({
    doc,
    append(node) {
      fallbackControl = node;
      node.parentNode = { kind: "plugin-area" };
    },
  });
  doc.showTextButton();
  context.rtsInstallTextSizeControl({ doc });

  assert.equal(installed, true);
  assert.equal(fallbackControl.children[0].value, "24");
  assert.equal(fallbackControl._insertedAfterTextButton, true);
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
          TEXT_FONT_SIZE_STEPS: [3, 4, 5, 6, 8, 10, 12, 14, 18, 24, 36, 48, 64, 72, 96, 144, 192],
          isEditableTarget: () => false,
          toolForEvent: () => null,
          activateTool: () => false,
          activateBlackTextColor: () => false,
          normalizeTextToolDefaults: defaults => defaults,
          applyTextToolDefaults: () => false,
          normalizeTextMaxWidth: value => Number(value) || 900,
          normalizeTextLineHeight: value => Number(value) || 1.2,
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
  const prefBranch = "extensions.reader-tool-shortcuts.";
  const prefs = new Map([[prefBranch + "textSize", 24], [prefBranch + "textLineHeight", "2"]]);
  const zotero = {
    initializationPromise: Promise.resolve(),
    Prefs: {
      get: key => prefs.get(key),
      set: (key, value) => prefs.set(key, value),
    },
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
          TEXT_FONT_SIZE_STEPS: [3, 4, 5, 6, 8, 10, 12, 14, 18, 24, 36, 48, 64, 72, 96, 144, 192],
          isEditableTarget: () => false,
          toolForEvent: () => null,
          activateTool: () => false,
          activateBlackTextColor: () => false,
          normalizeTextToolDefaults: defaults => defaults,
          applyTextToolDefaults: () => false,
          normalizeTextMaxWidth: value => Number(value) || 900,
          normalizeTextLineHeight: value => Number(value) || 1.2,
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
  assert.equal(prefs.get(prefBranch + "textSize"), 6);
  assert.equal(prefs.get(prefBranch + "textLineHeight"), "1.8");
  prefs.set(prefBranch + "textSize", 12);
  prefs.set(prefBranch + "textLineHeight", "2.4");
  context.shutdown({}, context.APP_SHUTDOWN);
  await context.startup({ id: "plugin", rootURI: "file:///plugin/" });
  assert.equal(prefs.get(prefBranch + "textSize"), 12);
  assert.equal(prefs.get(prefBranch + "textLineHeight"), "2.4");
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

test("Reader scan restores and synchronizes a missing toolbar size control", () => {
  const context = loadBootstrap();
  const outer = fakeWindow();
  const doc = fakeToolbarDocument();
  outer.document = doc;
  const prefs = { textColor: "#2ea8e5", textSize: 12 };
  context.Zotero.Prefs.get = key => prefs[key.split(".").pop()];
  context.Zotero.Reader._readers = [{
    _iframeWindow: outer,
    _internalReader: { _tools: { text: {} } },
  }];
  activate(context, 44);

  context.rtsScanReaders(44);
  prefs.textSize = 36;
  context.rtsScanReaders(44);

  const select = doc.querySelector("#reader-tool-shortcuts-text-size").children[0];
  assert.equal(select.value, "36");
});

test("Reader scan synchronizes text-size controls across multiple toolbar documents", () => {
  const context = loadBootstrap();
  const firstWindow = fakeWindow();
  const secondWindow = fakeWindow();
  const firstDoc = fakeToolbarDocument();
  const secondDoc = fakeToolbarDocument();
  firstWindow.document = firstDoc;
  secondWindow.document = secondDoc;
  const prefs = { textColor: "#2ea8e5", textSize: 12 };
  context.Zotero.Prefs.get = key => prefs[key.split(".").pop()];
  context.Zotero.Prefs.set = (key, value) => {
    prefs[key.split(".").pop()] = value;
  };
  context.Zotero.Reader._readers = [firstWindow, secondWindow].map(win => ({
    _iframeWindow: win,
    _internalReader: { _tools: { text: {} } },
  }));
  activate(context, 45);
  context.rtsScanReaders(45);

  const firstSelect = firstDoc.querySelector("#reader-tool-shortcuts-text-size").children[0];
  firstSelect.value = "48";
  firstSelect.dispatch("change");
  context.rtsScanReaders(45);

  const secondSelect = secondDoc.querySelector("#reader-tool-shortcuts-text-size").children[0];
  assert.equal(firstSelect.value, "48");
  assert.equal(secondSelect.value, "48");
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
      exportFunction: fn => fn,
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

test("top-row 9 is routed with toolbar and Reader-realm cloning", () => {
  const context = loadBootstrap();
  const win = fakeWindow();
  const readerRealm = { id: "reader-realm" };
  const reader = { id: "reader", _iframeWindow: readerRealm };
  let received = null;
  context.Components = {
    utils: {
      exportFunction: fn => fn,
      cloneInto(value, target) { return { value, target }; },
    },
  };
  context.ReaderToolShortcutsCore.activateBlackTextColor = (
    candidate,
    event,
    toolbarDoc,
    cloneForReader
  ) => {
    received = {
      candidate,
      code: event.code,
      toolbarDoc,
      cloned: cloneForReader({ color: "#000000" }),
    };
    return true;
  };
  activate(context, 8);
  context.rtsAttachToWindow(win, win.document, 8, reader);
  let prevented = 0;
  let stopped = 0;

  win.emit("keydown", {
    code: "Digit9",
    target: {},
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    preventDefault() { prevented++; },
    stopPropagation() { stopped++; },
  });

  assert.deepEqual(received, {
    candidate: reader,
    code: "Digit9",
    toolbarDoc: win.document,
    cloned: { value: { color: "#000000" }, target: readerRealm },
  });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

function lineHeightFixture() {
  const context = loadBootstrap();
  context.ReaderToolShortcutsCore = require("../src/core.js");
  context.Components = { utils: { exportFunction: fn => fn, cloneInto: structuredClone } };
  const styles = [];
  const doc = {
    head: { append(node) { styles.push(node); } },
    createElement() {
      return { textContent: "", remove() { styles.splice(styles.indexOf(this), 1); } };
    },
    getElementById(id) { return styles.find(style => style.id === id); },
  };
  const calls = [];
  const native = function (annotation, options = {}) {
    const css = styles.at(-1)?.textContent || "";
    const spacing = Number(/line-height:\s*([\d.]+)/.exec(css)?.[1]) || 1.2;
    calls.push({ annotation: structuredClone(annotation), options, spacing, owner: this });
    const position = structuredClone(annotation.position);
    const rect = position.rects[0];
    if (options.adjustSingleLineWidth && rect[3] - rect[1] < 2 * position.fontSize) {
      rect[2] = rect[0] + Math.max(10, annotation.comment.length * 5);
    }
    const lines = annotation.comment.split("\n").length;
    rect[3] = rect[1] + lines * position.fontSize * spacing;
    return position;
  };
  const primary = { _iframeWindow: { document: doc }, adjustTextAnnotationPosition: native };
  const secondary = { adjustTextAnnotationPosition: native };
  const manager = {
    _annotations: [],
    _adjustTextAnnotationPosition: (a, o) => primary.adjustTextAnnotationPosition(a, o),
    render() { this.rendered = true; },
  };
  const reader = {
    _iframeWindow: { document: {} },
    _internalReader: { _annotationManager: manager, _primaryView: primary, _secondaryView: secondary },
  };
  context.Zotero.Prefs.get = () => "1.8";
  context.rtsPatchTextWidth(reader, 900);
  return { context, manager, reader, primary, secondary, native, doc, styles, calls };
}

test("line spacing fits multiline height without changing text or font size", () => {
  const { manager, styles, calls } = lineHeightFixture();
  const annotation = { id: "TEXT1", type: "text", comment: "first\nsecond", position: { fontSize: 10, rects: [[10, 20, 110, 44]] } };
  const before = structuredClone(annotation);
  const position = manager._adjustTextAnnotationPosition(annotation, { adjustSingleLineWidth: false });
  assert.equal(position.rects[0][3] - position.rects[0][1], 36);
  assert.equal(position.rtsLineHeight, 1.8);
  assert.equal(position.fontSize, 10);
  assert.deepEqual(annotation, before);
  assert.equal(calls.at(-1).options.adjustSingleLineWidth, false);
  assert.equal(styles.length, 1, "temporary measurement styles must be removed");
});

test("large line spacing still lets a single-line box grow when typing", () => {
  const { context, manager, calls } = lineHeightFixture();
  context.Zotero.Prefs.get = () => "2.5";
  const annotation = { id: "TEXT2", type: "text", comment: "short", position: { fontSize: 10, rects: [[10, 20, 35, 32]] } };
  annotation.position = manager._adjustTextAnnotationPosition(annotation, { adjustSingleLineWidth: true, enableSingleLineMaxWidth: true });
  manager._annotations = [annotation];
  const edited = { ...annotation, comment: "a substantially longer sentence" };
  const position = manager._adjustTextAnnotationPosition(edited, { adjustSingleLineWidth: true, enableSingleLineMaxWidth: true });
  assert.equal(position.rects[0][3] - position.rects[0][1], 25);
  assert.ok(position.rects[0][2] > annotation.position.rects[0][2]);
  assert.equal(calls.at(-1).spacing, 2.5);
});

test("stored spacing survives default changes, rendering, split views and cleanup", () => {
  const { context, manager, reader: lineReader, primary, secondary, native, doc, styles } = lineHeightFixture();
  context.Zotero.Prefs.get = () => "2.5";
  const annotation = { id: "SAVED", type: "text", comment: "first\nsecond", position: { fontSize: 10, rtsLineHeight: 1.5, rects: [[10, 20, 110, 50]] } };
  manager._annotations = [annotation, { id: "OLD", type: "text", position: {} }];
  const position = secondary.adjustTextAnnotationPosition(annotation, { adjustSingleLineWidth: false });
  assert.equal(position.rtsLineHeight, 1.5);
  assert.equal(position.rects[0][3] - position.rects[0][1], 30);
  manager.render();
  context.rtsPatchTextWidth(lineReader, 900);
  assert.equal(manager.rendered, true);
  const css = doc.getElementById("reader-tool-shortcuts-line-height").textContent;
  assert.match(css, /data-id="SAVED".*line-height: 1\.5/);
  assert.doesNotMatch(css, /OLD/);
  context.rtsRestoreTextWidthPatches();
  assert.equal(primary.adjustTextAnnotationPosition, native);
  assert.equal(secondary.adjustTextAnnotationPosition, native);
  assert.equal(styles.length, 0);
});

test("measurement errors cannot leave line-height overrides in the PDF document", () => {
  const { manager, styles } = lineHeightFixture();
  assert.throws(() => manager._adjustTextAnnotationPosition({ position: { rects: [] } }), TypeError);
  assert.equal(styles.length, 1);
});

test("toolbar spacing saves a string preference and only updates selected editable text", () => {
  const context = loadBootstrap();
  context.ReaderToolShortcutsCore = require("../src/core.js");
  context.Components = { utils: { exportFunction: fn => fn, cloneInto: structuredClone } };
  const doc = {};
  const updates = [];
  const writes = [];
  const manager = {
    _annotations: [
      { id: "YES", type: "text", sortIndex: "1", position: {} },
      { id: "NO", type: "text", sortIndex: "2", position: {} },
      { id: "READONLY", type: "text", readOnly: true, position: {} },
      { id: "HIGHLIGHT", type: "highlight", position: {} },
    ],
    _adjustTextAnnotationPosition: annotation => annotation.position,
    updateAnnotations: annotations => updates.push(...annotations),
  };
  context.Zotero.Prefs.set = (key, value) => writes.push([key, value]);
  context.Zotero.Reader._readers = [{ _iframeWindow: { document: doc }, _internalReader: {
    _annotationManager: manager, _state: { selectedAnnotationIDs: ["YES", "READONLY", "HIGHLIGHT"] },
  } }];
  assert.equal(context.rtsSetTextLineHeight("1.5", doc), true);
  assert.deepEqual(writes, [["extensions.reader-tool-shortcuts.textLineHeight", "1.5"]]);
  assert.deepEqual(updates, [{ id: "YES", sortIndex: "1", position: { rtsLineHeight: 1.5 } }]);
  assert.equal(context.rtsSetTextLineHeight("3.5", doc), false);
  assert.equal(writes.length, 1);
});

test("annotation popup changes selected font size and spacing without modifying defaults", () => {
  const context = loadBootstrap();
  context.ReaderToolShortcutsCore = require("../src/core.js");
  context.Components = { utils: { exportFunction: fn => fn, cloneInto: structuredClone } };
  const doc = fakeToolbarDocument();
  const annotation = { id: "TEXT", type: "text", sortIndex: "1", position: { fontSize: 5, rtsLineHeight: 1.5 } };
  const manager = { _annotations: [annotation],
    _adjustTextAnnotationPosition: a => a.position,
    updateAnnotations(updates) { for (const update of updates) Object.assign(annotation, update); },
  };
  const reader = { _iframeWindow: {}, _internalReader: { _annotationManager: manager } };
  let controls;
  context.rtsInstallAnnotationControls({ reader, doc, params: { annotation }, append: value => controls = value });
  const [size, spacing] = controls.children;
  assert.equal(size.children[0].value, "3");
  assert.equal(size.children.at(-1).value, "192");
  assert.equal(size.value, "5");
  size.value = "3"; size.dispatch("change");
  assert.equal(annotation.position.fontSize, 3);
  assert.equal(annotation.position.rtsLineHeight, 1.5);
  spacing.value = "2"; spacing.dispatch("change");
  assert.equal(annotation.position.fontSize, 3);
  assert.equal(annotation.position.rtsLineHeight, 2);
});

test("native text menu keeps its font slider with the original plugin steps", () => {
  const context = loadBootstrap();
  context.ReaderToolShortcutsCore = require("../src/core.js");
  context.Components = { utils: { exportFunction: fn => fn, cloneInto: structuredClone } };
  const open = function (menu) { return menu; };
  const internal = { _onOpenContextMenu: open, _annotationManager: {
    _annotations: [{ id: "TEXT", type: "text", position: { fontSize: 5 } }],
  } };
  let added;
  context.rtsHandleAnnotationContextMenu({ reader: { _iframeWindow: {}, _internalReader: internal }, params: { ids: ["TEXT"] }, append: item => added = item });
  const font = { slider: true, steps: [6, 8, 192] };
  const ink = { slider: true, steps: [.5, 1, 3] };
  internal._onOpenContextMenu({ itemGroups: [[font, ink]] });
  assert.deepEqual(font.steps, require("../src/core.js").TEXT_FONT_SIZE_STEPS);
  assert.deepEqual(ink.steps, [.5, 1, 3]);
  assert.equal(internal._onOpenContextMenu, open);
  assert.equal(added.label, "줄 간격 변경…");
});

test("PDF hook leaves normal operations on the native worker and routes custom export only", async () => {
  const context = loadBootstrap();
  const calls = [];
  const manager = { _init() {}, _query(action, data, ...args) {
    calls.push({ owner: this, action, data, args }); return Promise.resolve("ok");
  } };
  let closed = 0, loaded = 0;
  const state = { close() { closed++; } };
  context.Zotero.PDFWorker = manager;
  context.rtsCreatePDFExportWorker = async () => { loaded++; return state; };
  const original = manager._query;
  context.rtsPatchPDFExport();
  await manager._query("pdf.getFulltext", {});
  await manager._query("pdf.writeAnnotations", { annotations: [{ type: "text", position: {} }] });
  const data = { annotations: [{ type: "text", position: { rtsLineHeight: 1.5 } }] };
  const transfer = [];
  await manager._query("pdf.writeAnnotations", data, transfer);
  await manager._query("pdf.writeAnnotations", data, transfer);
  assert.equal(calls[0].owner, manager);
  assert.equal(calls[1].owner, manager);
  assert.equal(calls[2].owner, state);
  assert.equal(calls[2].data, data);
  assert.equal(calls[2].args[0], transfer);
  assert.equal(loaded, 1);
  context.rtsRestorePDFExport();
  await Promise.resolve();
  assert.equal(manager._query, original);
  assert.equal(closed, 1);
});

test("disabling the plugin lets an active PDF export finish before closing its worker", async () => {
  const context = loadBootstrap();
  let finish, closed = 0;
  const result = new Promise(resolve => finish = resolve);
  const manager = { _init() {}, _query() { return result; } };
  context.Zotero.PDFWorker = manager;
  context.rtsCreatePDFExportWorker = async () => ({ close() { closed++; } });
  context.rtsPatchPDFExport();
  const pending = manager._query("pdf.writeAnnotations", { annotations: [{ type: "text", position: { rtsLineHeight: 2 } }] });
  await Promise.resolve();
  context.rtsRestorePDFExport();
  assert.equal(closed, 0);
  finish("done");
  assert.equal(await pending, "done");
  await Promise.resolve();
  assert.equal(closed, 1);
});


test("Reader callbacks are exported into its own realm before native code calls them", () => {
  const { context, reader, manager, primary, secondary } = lineHeightFixture();
  context.rtsRestoreTextWidthPatches();
  const nativeRender = manager.render;
  const exported = new Set();
  context.Components.utils.exportFunction = (fn, target) => {
    assert.equal(target, reader._iframeWindow);
    const wrapper = function (...args) { return fn.apply(this, args); };
    exported.add(wrapper);
    return wrapper;
  };
  context.rtsPatchTextWidth(reader, 900);
  assert.equal(manager.render, nativeRender, "keep the native rendering function intact");
  for (const callback of [manager._adjustTextAnnotationPosition,
    primary.adjustTextAnnotationPosition, secondary.adjustTextAnnotationPosition]) {
    assert.ok(exported.has(callback));
  }
  manager.render();
  assert.equal(manager.rendered, true);
  context.rtsRestoreTextWidthPatches();
});


test("repeated scans use the installed realm wrapper instead of nesting callbacks", () => {
  const { context, reader, manager, primary, secondary } = lineHeightFixture();
  context.rtsRestoreTextWidthPatches();
  let assignments = 0;
  for (const [owner, property] of [[manager, "_adjustTextAnnotationPosition"],
    [primary, "adjustTextAnnotationPosition"], [secondary, "adjustTextAnnotationPosition"]]) {
    let installed = owner[property];
    Object.defineProperty(owner, property, {
      configurable: true,
      get: () => installed,
      set(callback) {
        assignments++;
        // Model Gecko exposing a different callable when a property is read.
        installed = function (...args) { return callback.call(this, ...args); };
      },
    });
  }
  for (let scan = 0; scan < 40; scan++) context.rtsPatchTextWidth(reader, 900);
  assert.equal(assignments, 3, "install each callback once across repeated scans");
  context.rtsRestoreTextWidthPatches();
  assert.equal(assignments, 6, "restore all three native callbacks");
});


test("native measurement spacing is applied and removed in both Reader frame versions", () => {
  const { context, reader, manager } = lineHeightFixture();
  const outerStyles = [];
  const values = [];
  reader._iframeWindow.document = {
    head: { append(style) { outerStyles.push(style); } },
    createElement() {
      return {
        set textContent(value) { values.push(value); },
        remove() { outerStyles.splice(outerStyles.indexOf(this), 1); },
      };
    },
  };
  manager._adjustTextAnnotationPosition({ comment: "first\nsecond", position: {
    fontSize: 12, rtsLineHeight: 2, rects: [[10, 20, 110, 44]],
  } });
  assert.ok(values.some(css => css.includes("line-height: 1.2")));
  assert.ok(values.some(css => css.includes("line-height: 2")));
  assert.equal(outerStyles.length, 0);
  context.rtsRestoreTextWidthPatches();
});
