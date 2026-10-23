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
var ReaderToolShortcutsConfiguredReaders = new WeakMap();
var ReaderToolShortcutsTextWidthPatches = [];

const RTS_PREF_BRANCH = "extensions.reader-tool-shortcuts.";
const RTS_TEXT_SIZE_CONTROL_ID = "reader-tool-shortcuts-text-size";

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

function rtsGetTextToolDefaults() {
  return ReaderToolShortcutsCore.normalizeTextToolDefaults({
    color: Zotero.Prefs.get(RTS_PREF_BRANCH + "textColor"),
    size: Zotero.Prefs.get(RTS_PREF_BRANCH + "textSize"),
  });
}

function rtsGetTextMaxWidth() {
  return ReaderToolShortcutsCore.normalizeTextMaxWidth(
    Zotero.Prefs.get(RTS_PREF_BRANCH + "textMaxWidth")
  );
}

function rtsApplyTextSize(size) {
  const defaults = ReaderToolShortcutsCore.normalizeTextToolDefaults({
    color: Zotero.Prefs.get(RTS_PREF_BRANCH + "textColor"),
    size,
  });
  let readers;
  try {
    readers = [...(Zotero.Reader?._readers || [])];
  }
  catch (error) {
    return;
  }
  for (const reader of readers) {
    try {
      const internalReader = reader?._internalReader;
      if (!internalReader) continue;
      if (ReaderToolShortcutsCore.applyTextToolDefaults(reader, defaults)) {
        ReaderToolShortcutsConfiguredReaders.set(
          internalReader,
          `${defaults.color}:${defaults.size}`
        );
      }
    }
    catch (error) {
      // A reader wrapper may have been destroyed during the update.
    }
  }
}

function rtsSetTextSize(value) {
  const size = Number(value);
  if (!ReaderToolShortcutsCore.TEXT_FONT_SIZE_STEPS.includes(size)) return false;
  Zotero.Prefs.set(RTS_PREF_BRANCH + "textSize", size);
  rtsApplyTextSize(size);
  return true;
}

function rtsInstallTextSizeControl(event) {
  const doc = event?.doc;
  if (!doc?.querySelector || !doc?.createElement) return false;

  let container = doc.querySelector(`#${RTS_TEXT_SIZE_CONTROL_ID}`);
  if (!container) {
    container = doc.createElement("span");
    container.id = RTS_TEXT_SIZE_CONTROL_ID;
    container.style.cssText = "display:inline-flex;align-items:center;margin-inline:3px;";

    const select = doc.createElement("select");
    select.title = "Text box font size";
    select.setAttribute?.("aria-label", "Text box font size");
    select.style.cssText = "height:28px;min-width:52px;padding:0 4px;border-radius:5px;color:inherit;background:inherit;-moz-window-dragging:no-drag;";
    for (const size of ReaderToolShortcutsCore.TEXT_FONT_SIZE_STEPS) {
      const option = doc.createElement("option");
      option.value = String(size);
      option.textContent = String(size);
      select.append(option);
    }
    select.addEventListener("change", () => rtsSetTextSize(select.value));
    container.append(select);
  }

  container.children[0].value = String(rtsGetTextToolDefaults().size);
  const textButton = doc.querySelector(".toolbar-button.text");
  if (textButton?.after) {
    if (container.previousElementSibling !== textButton) {
      textButton.after(container);
    }
    return true;
  }
  if (!container.parentNode && typeof event.append === "function") {
    event.append(container);
    return true;
  }
  return Boolean(container.parentNode);
}

function rtsGetTextPageRect(reader, annotation) {
  const pageIndex = Number(annotation?.position?.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
  const viewBox = reader?._internalReader?._primaryView?._iframeWindow
    ?.PDFViewerApplication?.pdfViewer?._pages?.[pageIndex]?.viewport?.viewBox;
  return Array.isArray(viewBox) ? viewBox : null;
}

function rtsPatchTextWidth(reader, maxWidth) {
  const manager = reader?._internalReader?._annotationManager;
  const current = manager?._adjustTextAnnotationPosition;
  if (!manager || typeof current !== "function") return false;

  const existing = ReaderToolShortcutsTextWidthPatches.find(
    record => record.manager === manager
  );
  if (existing && existing.width === maxWidth && current === existing.wrapped) {
    return true;
  }
  if (existing) {
    if (current === existing.wrapped) {
      manager._adjustTextAnnotationPosition = existing.original;
    }
    ReaderToolShortcutsTextWidthPatches = ReaderToolShortcutsTextWidthPatches.filter(
      record => record !== existing
    );
  }

  const original = manager._adjustTextAnnotationPosition;
  const wrapped = ReaderToolShortcutsCore.createTextWidthAdjuster(
    original,
    maxWidth,
    annotation => rtsGetTextPageRect(reader, annotation),
    value => Components.utils.cloneInto(value, reader._iframeWindow)
  );
  manager._adjustTextAnnotationPosition = wrapped;
  ReaderToolShortcutsTextWidthPatches.push({ manager, original, wrapped, width: maxWidth });
  return true;
}

function rtsRestoreTextWidthPatches() {
  for (const { manager, original, wrapped } of ReaderToolShortcutsTextWidthPatches) {
    try {
      if (manager._adjustTextAnnotationPosition === wrapped) {
        manager._adjustTextAnnotationPosition = original;
      }
    }
    catch (error) {}
  }
  ReaderToolShortcutsTextWidthPatches = [];
}

function rtsRestoreStaleTextWidthPatches(liveManagers) {
  ReaderToolShortcutsTextWidthPatches = ReaderToolShortcutsTextWidthPatches.filter(record => {
    if (liveManagers.has(record.manager)) return true;
    try {
      if (record.manager._adjustTextAnnotationPosition === record.wrapped) {
        record.manager._adjustTextAnnotationPosition = record.original;
      }
    }
    catch (error) {}
    return false;
  });
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

function rtsAttachToWindow(win, toolbarDoc, generation, reader) {
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
    if (reader) existing.reader = reader;
    return;
  }

  const record = {
    win,
    toolbarDoc,
    reader,
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

    try {
      if (ReaderToolShortcutsCore.activateBlackTextColor(
        record.reader,
        event,
        record.toolbarDoc,
        value => Components.utils.cloneInto(value, record.reader._iframeWindow)
      )) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    } catch (error) {
      Zotero.logError(error);
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
  const liveManagers = new Set();
  const textDefaults = rtsGetTextToolDefaults();
  const textDefaultsSignature = `${textDefaults.color}:${textDefaults.size}`;
  const textMaxWidth = rtsGetTextMaxWidth();
  let complete = true;
  for (const reader of readers) {
    try {
      const internalReader = reader?._internalReader;
      const annotationManager = internalReader?._annotationManager;
      if (annotationManager) liveManagers.add(annotationManager);
      rtsPatchTextWidth(reader, textMaxWidth);
      if (
        internalReader &&
        ReaderToolShortcutsConfiguredReaders.get(internalReader) !== textDefaultsSignature &&
        ReaderToolShortcutsCore.applyTextToolDefaults(reader, textDefaults)
      ) {
        ReaderToolShortcutsConfiguredReaders.set(internalReader, textDefaultsSignature);
      }
      const toolbarDoc = reader?._iframeWindow?.document;
      if (!toolbarDoc) continue;
      rtsInstallTextSizeControl({ doc: toolbarDoc });
      const windows = [
        reader._iframeWindow,
        reader._internalReader?._primaryView?._iframeWindow,
        reader._internalReader?._secondaryView?._iframeWindow,
      ].filter(Boolean);
      for (const win of windows) {
        liveWindows.add(win);
        rtsAttachToWindow(win, toolbarDoc, generation, reader);
      }
    }
    catch (error) {
      complete = false;
    }
  }

  if (complete) {
    rtsRestoreStaleTextWidthPatches(liveManagers);
    for (const record of [...ReaderToolShortcutsWindows]) {
      if (!liveWindows.has(record.win)) rtsDetachWindow(record.win);
    }
  }
}

function rtsHandleReaderEvent(event) {
  rtsInstallTextSizeControl(event);
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

function rtsRemoveTextSizeControls() {
  for (const reader of Zotero.Reader?._readers || []) {
    try {
      reader?._iframeWindow?.document
        ?.querySelector(`#${RTS_TEXT_SIZE_CONTROL_ID}`)
        ?.remove();
    }
    catch (error) {
      // The reader document may already have been destroyed.
    }
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
  rtsRestoreTextWidthPatches();
  rtsRemoveTextSizeControls();

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
