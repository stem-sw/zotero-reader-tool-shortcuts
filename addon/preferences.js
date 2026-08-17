(function () {
  "use strict";

  const PREF_BRANCH = "extensions.reader-tool-shortcuts.";
  const core = ReaderToolShortcutsCore;

  function prefKey(name) {
    return PREF_BRANCH + name;
  }

  function getValue(name) {
    return Zotero.Prefs.get(prefKey(name)) || "";
  }

  function setValue(name, value) {
    Zotero.Prefs.set(prefKey(name), value);
  }

  function toolByPref(name) {
    return core.TOOLS.find(tool => tool.pref === name);
  }

  function inputByPref(name) {
    return document.querySelector(`input[data-pref="${name}"]`);
  }

  function setStatus(message, isError = false) {
    const status = document.getElementById("rts-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function refreshInput(name) {
    const input = inputByPref(name);
    if (input) input.value = core.formatShortcut(getValue(name));
  }

  function refreshTextDefaults() {
    const defaults = core.normalizeTextToolDefaults({
      color: getValue("textColor"),
      size: getValue("textSize"),
    });
    const colorInput = document.getElementById("rts-text-color");
    const sizeSelect = document.getElementById("rts-text-size");
    if (colorInput) colorInput.value = defaults.color;
    if (sizeSelect) sizeSelect.value = String(defaults.size);
  }

  function saveTextDefaults() {
    const colorInput = document.getElementById("rts-text-color");
    const sizeSelect = document.getElementById("rts-text-size");
    const defaults = core.normalizeTextToolDefaults({
      color: colorInput?.value,
      size: sizeSelect?.value,
    });
    setValue("textColor", defaults.color);
    setValue("textSize", defaults.size);
    refreshTextDefaults();
    setStatus(`텍스트 상자 기본값을 ${defaults.color}, 크기 ${defaults.size}로 저장했습니다.`);
  }

  function hasDuplicate(name, shortcut) {
    const shortcuts = {};
    for (const tool of core.TOOLS) {
      shortcuts[tool.pref] = getValue(tool.pref);
    }
    return core.duplicateToolForShortcut(shortcuts, name, shortcut);
  }

  function handleShortcutKeydown(event) {
    event.preventDefault();
    event.stopPropagation();

    const shortcut = core.shortcutFromEvent(event);
    if (!shortcut) {
      setStatus("보조키와 함께 사용할 키를 계속 눌러 주세요.");
      return;
    }

    const name = event.currentTarget.dataset.pref;
    const duplicate = hasDuplicate(name, shortcut);
    if (duplicate) {
      setStatus(
        `${core.formatShortcut(shortcut)}은(는) 이미 다른 도구에 지정되어 있습니다.`,
        true
      );
      return;
    }

    setValue(name, shortcut);
    refreshInput(name);
    setStatus(`${core.formatShortcut(shortcut)}으로 저장했습니다.`);
    event.currentTarget.blur();
  }

  function init() {
    const inputs = document.querySelectorAll("input[data-pref]");
    if (!inputs.length) {
      setTimeout(init, 0);
      return;
    }

    for (const input of inputs) {
      refreshInput(input.dataset.pref);
      input.addEventListener("keydown", handleShortcutKeydown);
      input.addEventListener("focus", () => {
        setStatus("원하는 단축키 조합을 누르세요.");
        input.select();
      });
    }

    refreshTextDefaults();
    document.getElementById("rts-text-color")?.addEventListener("change", saveTextDefaults);
    document.getElementById("rts-text-size")?.addEventListener("change", saveTextDefaults);
    document.getElementById("rts-reset-text-defaults")?.addEventListener("click", () => {
      setValue("textColor", core.DEFAULT_TEXT_TOOL.color);
      setValue("textSize", core.DEFAULT_TEXT_TOOL.size);
      refreshTextDefaults();
      setStatus("텍스트 상자 기본값을 파란색, 크기 6으로 복원했습니다.");
    });

    for (const button of document.querySelectorAll("button[data-clear]")) {
      button.addEventListener("click", () => {
        const name = button.dataset.clear;
        setValue(name, "");
        refreshInput(name);
        setStatus("단축키를 해제했습니다.");
      });
    }

    for (const button of document.querySelectorAll("button[data-reset]")) {
      button.addEventListener("click", () => {
        const name = button.dataset.reset;
        const tool = toolByPref(name);
        const duplicate = hasDuplicate(name, tool.defaultShortcut);
        if (duplicate) {
          setStatus(
            `${core.formatShortcut(tool.defaultShortcut)}은(는) 이미 다른 도구에 지정되어 있습니다.`,
            true
          );
          return;
        }
        setValue(name, tool.defaultShortcut);
        refreshInput(name);
        setStatus(`${core.formatShortcut(tool.defaultShortcut)} 기본값으로 복원했습니다.`);
      });
    }
  }

  init();
})();
