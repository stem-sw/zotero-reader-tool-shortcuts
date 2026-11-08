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
var ReaderToolShortcutsPDFExportPatch;

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

function rtsGetTextLineHeight() {
  return ReaderToolShortcutsCore.normalizeTextLineHeight(
    Zotero.Prefs.get(RTS_PREF_BRANCH + "textLineHeight")
  );
}

function rtsSetTextLineHeight(value, doc) {
  const height = Number(value);
  if (!Number.isFinite(height) || height < 0.5 || height > 3) return false;
  const lineHeight = ReaderToolShortcutsCore.normalizeTextLineHeight(height);
  Zotero.Prefs.set(RTS_PREF_BRANCH + "textLineHeight", String(lineHeight));
  const reader = rtsReaderForDocument(doc);
  rtsUpdateTextAnnotations(reader, reader?._internalReader?._state?.selectedAnnotationIDs, { rtsLineHeight: lineHeight });
  return true;
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

function rtsSetTextSize(value, doc) {
  const size = Number(value);
  if (!ReaderToolShortcutsCore.TEXT_FONT_SIZE_STEPS.includes(size)) return false;
  Zotero.Prefs.set(RTS_PREF_BRANCH + "textSize", size);
  rtsApplyTextSize(size);
  const reader = rtsReaderForDocument(doc);
  rtsUpdateTextAnnotations(reader, reader?._internalReader?._state?.selectedAnnotationIDs, { fontSize: size });
  return true;
}

function rtsReaderForDocument(doc) {
  if (!doc) return null;
  return (Zotero.Reader?._readers || []).find(reader => {
    try { return reader._iframeWindow?.document === doc; }
    catch (error) { return false; }
  });
}

function rtsUpdateTextAnnotations(reader, ids, changes) {
  const manager = reader?._internalReader?._annotationManager;
  if (!manager || manager._readOnly) return;
  const selected = new Set(ids || []);
  const clone = value => Components.utils.cloneInto(value, reader._iframeWindow);
  const updates = (manager._annotations || [])
    .filter(a => selected.has(a.id) && a.type === "text" && !a.readOnly && !a.isExternal)
    .map(annotation => ({
      id: annotation.id,
      sortIndex: annotation.sortIndex,
      position: manager._adjustTextAnnotationPosition(clone({
        ...annotation, position: { ...annotation.position, ...changes },
      }), clone({ adjustSingleLineWidth: false })),
    }));
  if (updates.length) manager.updateAnnotations(clone(updates));
}

function rtsCreateTextFormatControls(doc, onSize, onSpacing) {
  const container = doc.createElement("span");
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
  select.addEventListener("change", () => onSize(Number(select.value)));
  const spacing = doc.createElement("input");
  spacing.type = "number";
  spacing.min = "0.5";
  spacing.max = "3";
  spacing.step = "0.1";
  spacing.title = "줄 간격 배수";
  spacing.setAttribute?.("aria-label", spacing.title);
  spacing.style.cssText = "height:28px;width:62px;margin-inline-start:4px;color:inherit;background:inherit;-moz-window-dragging:no-drag;";
  spacing.addEventListener("change", () => {
    const value = Number(spacing.value);
    if (Number.isFinite(value) && value >= 0.5 && value <= 3) {
      onSpacing(ReaderToolShortcutsCore.normalizeTextLineHeight(value));
    }
  });
  container.append(select, spacing);
  return container;
}

function rtsInstallAnnotationControls(event) {
  const { reader, doc, params, append } = event;
  const annotation = params?.annotation;
  if (annotation?.type !== "text" || !doc?.createElement || !append) return;
  const controls = rtsCreateTextFormatControls(doc,
    fontSize => rtsUpdateTextAnnotations(reader, [annotation.id], { fontSize }),
    rtsLineHeight => rtsUpdateTextAnnotations(reader, [annotation.id], { rtsLineHeight }));
  controls.className = "reader-tool-shortcuts-annotation-format";
  controls.addEventListener("pointerdown", event => event.stopPropagation());
  controls.children[0].value = String(annotation.position.fontSize);
  controls.children[1].value = String(ReaderToolShortcutsCore.normalizeTextLineHeight(annotation.position.rtsLineHeight));
  for (const control of controls.children) {
    control.disabled = Boolean(annotation.readOnly || annotation.isExternal || reader?._internalReader?._annotationManager?._readOnly);
  }
  append(controls);
}

function rtsHandleAnnotationContextMenu(event) {
  const { reader, params, append } = event;
  const internal = reader?._internalReader;
  const annotations = internal?._annotationManager?._annotations?.filter(a => params.ids.includes(a.id));
  if (!annotations?.length || !annotations.every(a => a.type === "text")) return;
  const original = internal._onOpenContextMenu;
  if (typeof original === "function") {
    // The public event fires immediately before this menu is opened. Keep the
    // native font slider and handler, while matching the plugin's size steps.
    let installed;
    const once = Components.utils.exportFunction(function (menu) {
      if (internal._onOpenContextMenu === installed) internal._onOpenContextMenu = original;
      for (const item of (menu.itemGroups || []).flat()) {
        if (item.slider && item.steps?.includes(192)) {
          item.steps = Components.utils.cloneInto(ReaderToolShortcutsCore.TEXT_FONT_SIZE_STEPS, reader._iframeWindow);
        }
      }
      return original.call(this, menu);
    }, reader._iframeWindow);
    internal._onOpenContextMenu = once;
    installed = internal._onOpenContextMenu;
  }
  append({
    label: "줄 간격 변경…",
    disabled: Boolean(internal._annotationManager._readOnly || annotations.some(a => a.readOnly || a.isExternal)),
    onCommand() {
      const value = { value: String(ReaderToolShortcutsCore.normalizeTextLineHeight(annotations[0].position.rtsLineHeight)) };
      if (!Services.prompt.prompt(Zotero.getMainWindow(), "줄 간격", "글자 크기의 배수 (0.5–3.0)", value, null, {})) return;
      const height = Number(value.value);
      if (Number.isFinite(height) && height >= 0.5 && height <= 3) {
        rtsUpdateTextAnnotations(reader, params.ids, { rtsLineHeight: ReaderToolShortcutsCore.normalizeTextLineHeight(height) });
      }
    },
  });
}

function rtsInstallTextSizeControl(event) {
  const doc = event?.doc;
  if (!doc?.querySelector || !doc?.createElement) return false;

  let container = doc.querySelector(`#${RTS_TEXT_SIZE_CONTROL_ID}`);
  if (!container) {
    container = rtsCreateTextFormatControls(doc,
      size => rtsSetTextSize(size, doc), height => rtsSetTextLineHeight(height, doc));
    container.id = RTS_TEXT_SIZE_CONTROL_ID;
  }

  const internal = event.reader?._internalReader;
  const ids = internal?._state?.selectedAnnotationIDs || [];
  const selected = ids.length === 1 && internal?._annotationManager?._annotations
    ?.find(a => a.id === ids[0] && a.type === "text");
  container.children[0].value = String(selected?.position?.fontSize ?? rtsGetTextToolDefaults().size);
  const spacing = container.children[1];
  if (doc.activeElement !== spacing) {
    spacing.value = String(selected
      ? ReaderToolShortcutsCore.normalizeTextLineHeight(selected.position?.rtsLineHeight)
      : rtsGetTextLineHeight());
  }
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


function rtsMeasureTextLayout(reader, annotation, position) {
  const view = reader._internalReader._primaryView;
  const win = view._iframeWindow;
  const doc = win.document;
  if (!doc.body || !doc.createRange) return position;
  const scale = win.PDFViewerApplication?.pdfViewer?._pages?.[position.pageIndex]?.viewport?.scale || 1;
  const size = position.fontSize * scale;
  const rect = position.rects[0];
  const value = (annotation.comment || "").replace(/\r\n?/g, "\n");
  const probe = doc.createElement("div");
  probe.dir = "auto";
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;font-family:${reader._iframeWindow.computedFontFamily || "sans-serif"};font-size:${size}px;line-height:${position.rtsLineHeight};width:${(rect[2] - rect[0]) * scale}px;padding:0;border:0;margin:0;word-break:break-word;white-space:pre-wrap`;
  const baseline = doc.createElement("span");
  baseline.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  const text = doc.createTextNode(value || "M");
  probe.append(baseline, text);
  doc.body.append(probe);
  try {
    position.rtsBaseline = (baseline.getBoundingClientRect().top - probe.getBoundingClientRect().top) / size;
    const range = doc.createRange();
    const topAt = offset => {
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range.getBoundingClientRect().top;
    };
    const lengths = [];
    let offset = 0;
    // Binary-search each visual line rather than measuring every character.
    for (const paragraph of value.split("\n")) {
      const end = offset + paragraph.length;
      if (!paragraph.length) lengths.push(0);
      while (offset < end) {
        const top = topAt(offset);
        let low = offset + 1, high = end;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (Math.abs(topAt(middle - 1) - top) < size * position.rtsLineHeight / 2) low = middle;
          else high = middle - 1;
        }
        lengths.push(Array.from(value.slice(offset, low)).length);
        offset = low;
      }
      offset = end + 1;
    }
    position.rtsLineLengths = lengths;
  }
  finally { probe.remove(); }
  return position;
}

function rtsUpdateTextLineHeightStyles(reader, record, force = false) {
  force ||= record.annotations !== record.manager._annotations;
  record.annotations = record.manager._annotations;
  let css;
  for (const view of [reader._internalReader?._primaryView, reader._internalReader?._secondaryView]) {
    if (record.directView && view && typeof view.adjustTextAnnotationPosition === "function"
        && !record.views.some(entry => entry.view === view)) {
      const entry = { view, original: view.adjustTextAnnotationPosition };
      view.adjustTextAnnotationPosition = record.wrapped;
      entry.installed = view.adjustTextAnnotationPosition;
      record.views.push(entry);
    }
    const doc = view?._iframeWindow?.document;
    if (!doc?.head) continue;
    let style = doc.getElementById("reader-tool-shortcuts-line-height");
    if (style && !force) continue;
    if (css === undefined) {
      css = (record.manager._annotations || [])
        .filter(a => a.type === "text" && a.position?.rtsLineHeight != null && /^[A-Za-z0-9_-]+$/.test(a.id))
        .map(a => `.textAnnotation[data-id="${a.id}"] { line-height: ${ReaderToolShortcutsCore.normalizeTextLineHeight(a.position.rtsLineHeight)} !important; }`)
        .join("\n");
    }
    if (!style) {
      style = doc.createElement("style");
      style.id = "reader-tool-shortcuts-line-height";
      doc.head.append(style);
      record.styles.push(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }
}

function rtsRestoreTextPatch(record) {
  const { manager, original, installed, styles } = record;
  try {
    if (manager._adjustTextAnnotationPosition === installed) manager._adjustTextAnnotationPosition = original;
    for (const entry of record.views) {
      if (entry.view.adjustTextAnnotationPosition === entry.installed) entry.view.adjustTextAnnotationPosition = entry.original;
    }
    for (const style of styles) style.remove();
  }
  catch (error) {}
}

function rtsPatchTextWidth(reader, maxWidth) {
  const manager = reader?._internalReader?._annotationManager;
  const current = manager?._adjustTextAnnotationPosition;
  const primaryView = reader?._internalReader?._primaryView;
  const directView = typeof primaryView?.adjustTextAnnotationPosition === "function";
  if (!manager || typeof current !== "function") return false;

  const existing = ReaderToolShortcutsTextWidthPatches.find(
    record => record.manager === manager
  );
  if (existing && existing.width === maxWidth && current === existing.installed
      && existing.primaryView === primaryView && existing.directView === directView) {
    rtsUpdateTextLineHeightStyles(reader, existing);
    return true;
  }
  if (existing) {
    rtsRestoreTextPatch(existing);
    ReaderToolShortcutsTextWidthPatches = ReaderToolShortcutsTextWidthPatches.filter(
      record => record !== existing
    );
  }

  const original = manager._adjustTextAnnotationPosition;
  const nativeAdjust = directView ? primaryView.adjustTextAnnotationPosition.bind(primaryView) : original;
  const adjustWidth = ReaderToolShortcutsCore.createTextWidthAdjuster(
    nativeAdjust,
    maxWidth,
    annotation => rtsGetTextPageRect(reader, annotation),
    value => Components.utils.cloneInto(value, reader._iframeWindow)
  );
  const toReader = value => Components.utils.cloneInto(value, reader._iframeWindow);
  const wrapped = Components.utils.exportFunction(function (annotation, options = {}) {
    const doc = reader._internalReader?._primaryView?._iframeWindow?.document;
    if (!doc?.head || !annotation?.position?.rects) return adjustWidth.call(this, annotation, options);
    const lineHeight = ReaderToolShortcutsCore.normalizeTextLineHeight(
      annotation.position.rtsLineHeight ?? rtsGetTextLineHeight()
    );
    // Zotero uses height >= 2 * fontSize to distinguish multiline boxes.
    // Measure width at the native spacing first, then remeasure the height at
    // the requested spacing with width fixed, preserving native rotation/bounds.
    // Zotero versions measure in either the Reader or the PDF frame.
    const styles = [...new Set([doc, reader._iframeWindow?.document])]
      .filter(target => target?.head)
      .map(target => {
        const style = target.createElement("style");
        style.textContent = "body > textarea { line-height: 1.2 !important; }";
        target.head.append(style);
        return style;
      });
    const fixedWidth = { ...options, adjustSingleLineWidth: false, enableSingleLineMaxWidth: false };
    try {
      let source = annotation;
      const previous = manager._annotations?.find(a => a.id === annotation.id) || annotation;
      if (options.adjustSingleLineWidth && previous.position?.rtsLineHeight
          && previous.position.rtsLineHeight !== 1.2) {
        const position = nativeAdjust.call(this, toReader({
          ...annotation, comment: previous.comment,
        }), toReader(fixedWidth));
        source = { ...annotation, position };
      }
      let position = adjustWidth.call(this, toReader(source), toReader(options));
      if (lineHeight !== 1.2) {
        for (const style of styles) style.textContent = `body > textarea { line-height: ${lineHeight} !important; }`;
        position = nativeAdjust.call(this, toReader({ ...annotation, position }), toReader(fixedWidth));
      }
      return toReader(rtsMeasureTextLayout(reader, annotation, { ...position, rtsLineHeight: lineHeight }));
    }
    finally {
      for (const style of styles) style.remove();
    }
  }, reader._iframeWindow);
  wrapped._rtsTextMaxWidth = maxWidth;
  const record = { manager, original, wrapped, width: maxWidth, primaryView, directView, views: [], styles: [] };
  manager._adjustTextAnnotationPosition = wrapped;
  // Gecko returns a realm-specific function wrapper when the property is read.
  // Compare against that value so scans never wrap our own callback again.
  record.installed = manager._adjustTextAnnotationPosition;
  ReaderToolShortcutsTextWidthPatches.push(record);
  rtsUpdateTextLineHeightStyles(reader, record);
  return true;
}

function rtsRestoreTextWidthPatches() {
  for (const record of ReaderToolShortcutsTextWidthPatches) rtsRestoreTextPatch(record);
  ReaderToolShortcutsTextWidthPatches = [];
}

function rtsRestoreStaleTextWidthPatches(liveManagers) {
  ReaderToolShortcutsTextWidthPatches = ReaderToolShortcutsTextWidthPatches.filter(record => {
    if (liveManagers.has(record.manager)) return true;
    rtsRestoreTextPatch(record);
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
      rtsInstallTextSizeControl({ doc: toolbarDoc, reader });
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


function rtsReadResource(win, url, responseType = "text") {
  return new Promise((resolve, reject) => {
    const request = new win.XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = responseType;
    request.timeout = 15000;
    request.onload = () => {
      if (request.status === 0 || request.status === 200) resolve(request.response);
      else reject(new Error(`Cannot load plugin resource: ${url}`));
    };
    request.onerror = request.onabort = request.ontimeout = () => reject(new Error(`Cannot load plugin resource: ${url}`));
    request.send();
  });
}

async function rtsCreatePDFExportWorker(zotero, manager, core, rootURI) {
  const win = zotero.getMainWindow();
  let source;
  for (const url of [
    "resource://zotero/document-worker/worker.js",
    "resource://zotero/pdf-worker/worker.js",
  ]) {
    try { source = await rtsReadResource(win, url); break; }
    catch (error) {}
  }
  if (!source) throw new Error("Zotero PDF worker source could not be loaded.");
  const font = JSON.parse(await rtsReadResource(win, rootURI + "fonts/font.json"));
  source = core.patchPDFWorkerSource(source, font);
  const url = win.URL.createObjectURL(new win.Blob([source], { type: "application/javascript" }));
  const Worker = Components.utils.getGlobalForObject(manager._init).Worker;
  let worker;
  try { worker = new Worker(url); }
  catch (error) { win.URL.revokeObjectURL(url); throw error; }
  const state = { _lastPromiseID: 0, _waitingPromises: {} };
  let initialized = false;
  // Reuse Zotero's own RPC/asset handlers on our isolated worker. The native
  // initializer's temporary worker is immediately terminated; its worker and
  // pending requests for all other Zotero operations remain untouched.
  Object.defineProperty(state, "_worker", {
    get: () => initialized ? worker : null,
    set: temporary => { temporary.terminate(); initialized = true; },
  });
  state.close = () => { worker.terminate(); win.URL.revokeObjectURL(url); };
  worker.addEventListener("message", async event => {
    const message = event.data;
    if (message.action !== "FetchData" || !message.data.endsWith("/" + font.fileName)) return;
    event.stopImmediatePropagation();
    try {
      const buffer = await rtsReadResource(win, rootURI + "fonts/" + font.fileName, "arraybuffer");
      const bytes = new win.Uint8Array(buffer);
      worker.postMessage({ responseID: message.id, data: bytes }, [bytes.buffer]);
    }
    catch (error) {
      worker.postMessage({ responseID: message.id, error: { message: String(error) } });
    }
  });
  worker.addEventListener("error", event => {
    state.error = new Error(`PDF export worker failed: ${event.message}`);
    for (const waiting of Object.values(state._waitingPromises)) waiting.reject(state.error);
    state._waitingPromises = {};
    state.close();
  });
  try { manager._init.call(state); }
  catch (error) { state.close(); throw error; }
  return state;
}

function rtsPatchPDFExport(rootURI) {
  const manager = Zotero.PDFWorker;
  if (!manager || typeof manager._query !== "function" || typeof manager._init !== "function") return false;
  const zotero = Zotero;
  const core = ReaderToolShortcutsCore;
  const record = { manager, original: manager._query, load: null, active: 0, disposed: false };
  record.wrapped = async function (action, data, ...args) {
    const custom = ["pdf.writeAnnotations", "export"].includes(action)
      && data?.annotations?.some(a => a.type === "text" && a.position?.rtsLineHeight != null);
    if (!custom) return record.original.call(this, action, data, ...args);
    record.active++;
    try {
      record.load ||= rtsCreatePDFExportWorker(zotero, manager, core, rootURI);
      const state = await record.load;
      if (state.error) throw state.error;
      return await record.original.call(state, action, data, ...args);
    }
    finally {
      record.active--;
      if (record.disposed && !record.active) record.load?.then(state => state.close(), () => {});
    }
  };
  manager._query = record.wrapped;
  ReaderToolShortcutsPDFExportPatch = record;
  return true;
}

function rtsRestorePDFExport() {
  const record = ReaderToolShortcutsPDFExportPatch;
  if (!record) return;
  if (record.manager._query === record.wrapped) record.manager._query = record.original;
  record.disposed = true;
  if (!record.active) record.load?.then(state => state.close(), () => {});
  ReaderToolShortcutsPDFExportPatch = null;
}

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

  // Apply the requested defaults once on upgrade, then retain user changes.
  if (zotero.Prefs.get(RTS_PREF_BRANCH + "textDefaultsVersion") !== "1.0.26") {
    zotero.Prefs.set(RTS_PREF_BRANCH + "textSize", 6);
    zotero.Prefs.set(RTS_PREF_BRANCH + "textLineHeight", "1.8");
    zotero.Prefs.set(RTS_PREF_BRANCH + "textDefaultsVersion", "1.0.26");
  }

  ReaderToolShortcutsListener = rtsHandleReaderEvent;

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    ReaderToolShortcutsListener,
    id
  );

  Zotero.Reader.registerEventListener("renderSidebarAnnotationHeader", rtsInstallAnnotationControls, id);
  Zotero.Reader.registerEventListener("createAnnotationContextMenu", rtsHandleAnnotationContextMenu, id);
  rtsPatchPDFExport(rootURI);
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
  rtsRestorePDFExport();
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
