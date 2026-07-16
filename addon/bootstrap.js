var Zotero;
var ReaderToolShortcutsCore;
var ReaderToolShortcutsPreferencePaneID;
var ReaderToolShortcutsListener;
var ReaderToolShortcutsWindows = [];
var ReaderToolShortcutsGeneration = 0;
var ReaderToolShortcutsShuttingDown = false;
var ReaderToolShortcutsScanTimer = null;
var ReaderToolShortcutsScanGeneration = null;
var ReaderToolShortcutsSetInterval;
var ReaderToolShortcutsClearInterval;

const RTS_PREF_BRANCH = "extensions.reader-tool-shortcuts.";

function rtsLog(message) {
  Zotero.debug(`Reader Tool Shortcuts: ${message}`);
}

function rtsGetShortcuts() {
  const values = {};
  for (const tool of ReaderToolShortcutsCore.TOOLS) {
    values[tool.pref] = Zotero.Prefs.get(RTS_PREF_BRANCH + tool.pref) || "";
  }
  return values;
}

function rtsDetachWindow(win) {
  const record = ReaderToolShortcutsWindows.find(item => item.win === win);
  if (!record) return;
  try {
    win.removeEventListener("keydown", record.handler, true);
    win.removeEventListener("unload", record.unloadHandler, true);
  }
  catch (error) {
    // The reader window may already have been destroyed.
  }
  ReaderToolShortcutsWindows = ReaderToolShortcutsWindows.filter(
    item => item !== record
  );
}

function rtsIsActive(generation) {
  return Boolean(
    !ReaderToolShortcutsShuttingDown &&
    generation === ReaderToolShortcutsGeneration &&
    ReaderToolShortcutsCore
  );
}

function rtsIsStartupCurrent(generation, zotero) {
  return Boolean(
    !ReaderToolShortcutsShuttingDown &&
    generation === ReaderToolShortcutsGeneration &&
    Zotero === zotero
  );
}

function rtsAttachToWindow(win, toolbarDoc, generation) {
  if (
    !win ||
    !toolbarDoc ||
    ReaderToolShortcutsShuttingDown ||
    generation !== ReaderToolShortcutsGeneration
  ) {
    return;
  }
  const existing = ReaderToolShortcutsWindows.find(
    record => record.win === win
  );
  if (existing) {
    existing.toolbarDoc = toolbarDoc;
    return;
  }

  const record = {
    win,
    toolbarDoc,
    handler: null,
    unloadHandler: null,
  };
  record.handler = event => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      ReaderToolShortcutsCore.isEditableTarget(event.target)
    ) {
      return;
    }

    const tool = ReaderToolShortcutsCore.toolForEvent(event, rtsGetShortcuts());
    if (!tool) return;

    // This invokes Zotero's own handleToolClick() path. It changes only the
    // active annotation mode; it does not move the pointer or create an annotation.
    if (ReaderToolShortcutsCore.activateTool(record.toolbarDoc, tool)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  record.unloadHandler = () => rtsDetachWindow(win);
  let keydownAttached = false;
  try {
    win.addEventListener("keydown", record.handler, true);
    keydownAttached = true;
    win.addEventListener("unload", record.unloadHandler, true);
    ReaderToolShortcutsWindows.push(record);
  }
  catch (error) {
    if (keydownAttached) {
      try {
        win.removeEventListener("keydown", record.handler, true);
      }
      catch (cleanupError) {}
    }
  }
}

function rtsScanReaders(generation) {
  if (!rtsIsActive(generation)) return;

  let readers;
  try {
    readers = [...(Zotero.Reader?._readers || [])];
  }
  catch (error) {
    return;
  }

  const liveWindows = new Set();
  let complete = true;
  for (const reader of readers) {
    try {
      const toolbarDoc = reader?._iframeWindow?.document;
      if (!toolbarDoc) continue;
      const windows = [
        reader._iframeWindow,
        reader._internalReader?._primaryView?._iframeWindow,
        reader._internalReader?._secondaryView?._iframeWindow,
      ].filter(Boolean);
      for (const win of windows) {
        liveWindows.add(win);
        rtsAttachToWindow(win, toolbarDoc, generation);
      }
    }
    catch (error) {
      complete = false;
    }
  }

  if (complete) {
    for (const record of [...ReaderToolShortcutsWindows]) {
      if (!liveWindows.has(record.win)) rtsDetachWindow(record.win);
    }
  }
}

function rtsHandleReaderEvent() {
  rtsScanReaders(ReaderToolShortcutsGeneration);
}

function rtsStartReaderScan(generation) {
  rtsScanReaders(generation);
  if (
    ReaderToolShortcutsScanTimer !== null &&
    ReaderToolShortcutsScanGeneration === generation
  ) {
    return;
  }
  rtsStopReaderScan();
  ReaderToolShortcutsScanGeneration = generation;
  ReaderToolShortcutsScanTimer = ReaderToolShortcutsSetInterval(
    () => rtsScanReaders(generation),
    250
  );
}

function rtsStopReaderScan() {
  if (ReaderToolShortcutsScanTimer !== null) {
    ReaderToolShortcutsClearInterval(ReaderToolShortcutsScanTimer);
  }
  ReaderToolShortcutsScanTimer = null;
  ReaderToolShortcutsScanGeneration = null;
}

function rtsDetachAllReaderWindows() {
  for (const { win } of [...ReaderToolShortcutsWindows]) {
    rtsDetachWindow(win);
  }
}

function install() {}

async function startup({ id, rootURI }) {
  const generation = ++ReaderToolShortcutsGeneration;
  ReaderToolShortcutsShuttingDown = false;

  const timers = ChromeUtils.importESModule(
    "resource://gre/modules/Timer.sys.mjs"
  );
  ReaderToolShortcutsSetInterval = timers.setInterval;
  ReaderToolShortcutsClearInterval = timers.clearInterval;

  Zotero = ChromeUtils.importESModule(
    "chrome://zotero/content/zotero.mjs"
  ).Zotero;
  const zotero = Zotero;
  await zotero.initializationPromise;
  if (!rtsIsStartupCurrent(generation, zotero)) return;

  const coreScope = {};
  Services.scriptloader.loadSubScript(rootURI + "core.js", coreScope);
  ReaderToolShortcutsCore = coreScope.ReaderToolShortcutsCore;
  if (!ReaderToolShortcutsCore?.TOOLS) {
    throw new Error("Reader Tool Shortcuts core API failed to load");
  }

  const preferencePaneID = await zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + "preferences.xhtml",
    scripts: [rootURI + "core.js", rootURI + "preferences.js"],
    stylesheets: [rootURI + "preferences.css"],
    label: "Reader Tool Shortcuts",
  });
  if (!rtsIsStartupCurrent(generation, zotero)) {
    try {
      if (preferencePaneID && zotero.PreferencePanes.unregister) {
        zotero.PreferencePanes.unregister(preferencePaneID);
      }
    }
    catch (error) {
      // Shutdown may already have destroyed the preference-pane registry.
    }
    return;
  }
  ReaderToolShortcutsPreferencePaneID = preferencePaneID;

  ReaderToolShortcutsListener = rtsHandleReaderEvent;

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    ReaderToolShortcutsListener,
    id
  );

  rtsStartReaderScan(generation);

  rtsLog("started");
}

function shutdown(data, reason) {
  ReaderToolShortcutsShuttingDown = true;
  ReaderToolShortcutsGeneration++;
  rtsStopReaderScan();

  if (reason === APP_SHUTDOWN) return;

  rtsDetachAllReaderWindows();

  // Zotero removes Reader listeners by plugin ID during plugin shutdown.
  // Avoid calling unregisterEventListener here because Zotero 9.0.6's current
  // implementation has unsafe filtering behavior.
  ReaderToolShortcutsListener = null;

  if (
    ReaderToolShortcutsPreferencePaneID &&
    Zotero.PreferencePanes.unregister
  ) {
    Zotero.PreferencePanes.unregister(ReaderToolShortcutsPreferencePaneID);
  }

  ReaderToolShortcutsPreferencePaneID = null;
  ReaderToolShortcutsCore = null;
  Zotero = null;
}

function uninstall() {}
