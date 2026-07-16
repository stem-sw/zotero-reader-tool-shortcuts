var Zotero;
var ReaderToolShortcutsCore;
var ReaderToolShortcutsPreferencePaneID;
var ReaderToolShortcutsListener;
var ReaderToolShortcutsWindows = [];
var ReaderToolShortcutsGeneration = 0;
var ReaderToolShortcutsShuttingDown = false;

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

function rtsAttachToWindow(win, toolbarDoc, generation) {
  if (
    !win ||
    !toolbarDoc ||
    ReaderToolShortcutsShuttingDown ||
    generation !== ReaderToolShortcutsGeneration
  ) {
    return;
  }
  if (ReaderToolShortcutsWindows.some(record => record.win === win)) return;

  const handler = event => {
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
    if (ReaderToolShortcutsCore.activateTool(toolbarDoc, tool)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const unloadHandler = () => rtsDetachWindow(win);
  win.addEventListener("keydown", handler, true);
  win.addEventListener("unload", unloadHandler, true);
  ReaderToolShortcutsWindows.push({ win, handler, unloadHandler });
}

async function rtsAttachToReader(reader, generation) {
  if (!reader) return;
  try {
    await reader._waitForReader();
    await reader._initPromise;
    if (
      ReaderToolShortcutsShuttingDown ||
      generation !== ReaderToolShortcutsGeneration ||
      !ReaderToolShortcutsCore
    ) {
      return;
    }
    const toolbarDoc = reader._iframeWindow?.document;
    for (const win of ReaderToolShortcutsCore.getReaderEventWindows(reader)) {
      rtsAttachToWindow(win, toolbarDoc, generation);
    }
  }
  catch (error) {
    if (Zotero) Zotero.logError(error);
  }
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

  Zotero = ChromeUtils.importESModule(
    "chrome://zotero/content/zotero.mjs"
  ).Zotero;
  await Zotero.initializationPromise;

  const coreScope = {};
  Services.scriptloader.loadSubScript(rootURI + "core.js", coreScope);
  ReaderToolShortcutsCore = coreScope.ReaderToolShortcutsCore;

  ReaderToolShortcutsPreferencePaneID = await Zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + "preferences.xhtml",
    scripts: [rootURI + "core.js", rootURI + "preferences.js"],
    stylesheets: [rootURI + "preferences.css"],
    label: "Reader Tool Shortcuts",
  });

  ReaderToolShortcutsListener = ({ reader }) => {
    void rtsAttachToReader(reader, generation);
  };

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    ReaderToolShortcutsListener,
    id
  );

  for (const reader of Zotero.Reader._readers) {
    void rtsAttachToReader(reader, generation);
  }

  rtsLog("started");
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;

  ReaderToolShortcutsShuttingDown = true;
  ReaderToolShortcutsGeneration++;
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
