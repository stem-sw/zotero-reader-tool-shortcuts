(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ReaderToolShortcutsCore = api;
})(this, function () {
  "use strict";

  const TOOLS = [
    {
      id: "note",
      pref: "noteShortcut",
      selector: ".toolbar-button.note",
      defaultShortcut: "Alt+KeyN",
    },
    {
      id: "text",
      pref: "textShortcut",
      selector: ".toolbar-button.text",
      defaultShortcut: "Alt+KeyT",
    },
    {
      id: "area",
      pref: "areaShortcut",
      selector: ".toolbar-button.area",
      defaultShortcut: "Alt+KeyA",
    },
  ];

  const TEXT_FONT_SIZE_STEPS = [6, 8, 10, 12, 14, 18, 24, 36, 48, 64, 72, 96, 144, 192];
  const DEFAULT_TEXT_TOOL = { color: "#2ea8e5", size: 6 };

  const MODIFIER_KEYS = new Set([
    "Alt",
    "AltGraph",
    "Control",
    "Meta",
    "OS",
    "Shift",
  ]);

  function shortcutFromEvent(event) {
    if (!event || MODIFIER_KEYS.has(event.key) || !event.code) {
      return null;
    }

    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(event.code);
    return parts.join("+");
  }

  function formatCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`;
    const labels = {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Escape: "Esc",
      Equal: "=",
      Minus: "-",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backquote: "`",
    };
    return labels[code] || code;
  }

  function formatShortcut(shortcut) {
    if (!shortcut) return "지정 안 함";
    const parts = shortcut.split("+");
    parts[parts.length - 1] = formatCode(parts[parts.length - 1]);
    return parts.join("+");
  }

  function eventMatchesShortcut(event, shortcut) {
    if (!shortcut || !event || event.isComposing || event.repeat) {
      return false;
    }
    return shortcutFromEvent(event) === shortcut;
  }

  function toolForEvent(event, shortcuts) {
    for (const tool of TOOLS) {
      if (eventMatchesShortcut(event, shortcuts[tool.pref])) {
        return tool;
      }
    }
    return null;
  }

  function activateTool(doc, tool) {
    if (!doc || !tool) return false;
    const button = doc.querySelector(tool.selector);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function normalizeTextToolDefaults(defaults = {}) {
    const color = typeof defaults.color === "string" && /^#[0-9a-f]{6}$/i.test(defaults.color)
      ? defaults.color.toLowerCase()
      : DEFAULT_TEXT_TOOL.color;
    const requestedSize = Number(defaults.size);
    const size = TEXT_FONT_SIZE_STEPS.includes(requestedSize)
      ? requestedSize
      : DEFAULT_TEXT_TOOL.size;
    return { color, size };
  }

  function applyTextToolDefaults(reader, defaults) {
    const textTool = reader?._internalReader?._tools?.text;
    if (!textTool) return false;
    Object.assign(textTool, normalizeTextToolDefaults(defaults));
    return true;
  }

  function duplicateToolForShortcut(shortcuts, currentPref, shortcut) {
    if (!shortcut) return null;
    return TOOLS.find(
      tool => tool.pref !== currentPref && shortcuts[tool.pref] === shortcut
    ) || null;
  }

  function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
      )
    );
  }

  function getReaderEventWindows(reader) {
    if (!reader) return [];
    const windows = [
      reader._iframeWindow,
      reader._internalReader?._primaryView?._iframeWindow,
    ].filter(Boolean);
    return [...new Set(windows)];
  }

  return {
    TOOLS,
    shortcutFromEvent,
    formatShortcut,
    eventMatchesShortcut,
    toolForEvent,
    activateTool,
    TEXT_FONT_SIZE_STEPS,
    DEFAULT_TEXT_TOOL,
    normalizeTextToolDefaults,
    applyTextToolDefaults,
    duplicateToolForShortcut,
    isEditableTarget,
    getReaderEventWindows,
  };
});
