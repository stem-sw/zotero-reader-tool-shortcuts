const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "addon", "manifest.json");
const packagePath = path.join(__dirname, "..", "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));

test("Zotero target declares an HTTPS update URL", () => {
  const zotero = manifest.applications?.zotero;
  assert.ok(zotero, "applications.zotero must exist");
  assert.equal(typeof zotero.update_url, "string");
  assert.match(zotero.update_url, /^https:\/\//);
});

test("manifest and package versions match the Zotero 10 release", () => {
  assert.equal(manifest.version, "1.0.17");
  assert.equal(manifest.version, packageMetadata.version);
});

test("manifest supports Zotero 10 while retaining Zotero 9 compatibility", () => {
  const zotero = manifest.applications.zotero;
  assert.equal(zotero.strict_min_version, "9.0");
  assert.equal(zotero.strict_max_version, "10.0.*");
});

test("preference pane source is a raw XUL fragment, not a complete XML document", () => {
  const panePath = path.join(__dirname, "..", "addon", "preferences.xhtml");
  const pane = fs.readFileSync(panePath, "utf8").trim();
  assert.doesNotMatch(pane, /^<\?xml/);
  assert.doesNotMatch(pane, /<\/?fragment\b/);
  assert.match(pane, /^<vbox\b/);
  assert.match(pane, /id="zotero-prefpane-reader-tool-shortcuts"/);
});

test("preference pane exposes text color, font-size, and maximum-width controls", () => {
  const panePath = path.join(__dirname, "..", "addon", "preferences.xhtml");
  const pane = fs.readFileSync(panePath, "utf8");
  assert.match(pane, /id="rts-text-color"[^>]*type="color"/);
  assert.match(pane, /id="rts-text-size"/);
  assert.match(pane, /value="192"/);
  assert.match(pane, /id="rts-text-max-width"[^>]*type="number"/);
  assert.match(pane, /id="rts-text-max-width"[^>]*value="900"/);
});

test("shortcut preference defaults are Alt+3, Alt+4, and Alt+5", () => {
  const prefsPath = path.join(__dirname, "..", "addon", "prefs.js");
  const prefs = fs.readFileSync(prefsPath, "utf8");
  assert.match(prefs, /noteShortcut", "Alt\+Digit3"/);
  assert.match(prefs, /textShortcut", "Alt\+Digit4"/);
  assert.match(prefs, /areaShortcut", "Alt\+Digit5"/);
});

test("text annotation preference defaults remain blue, size 6, and width 900", () => {
  const prefsPath = path.join(__dirname, "..", "addon", "prefs.js");
  const prefs = fs.readFileSync(prefsPath, "utf8");
  assert.match(prefs, /textColor", "#2ea8e5"/);
  assert.match(prefs, /textSize", 6\)/);
  assert.match(prefs, /textMaxWidth", 900\)/);
});
