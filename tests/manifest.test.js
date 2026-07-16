const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "addon", "manifest.json");
const packagePath = path.join(__dirname, "..", "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));

test("Zotero target declares the update_url required by Zotero 9", () => {
  const zotero = manifest.applications?.zotero;
  assert.ok(zotero, "applications.zotero must exist");
  assert.equal(typeof zotero.update_url, "string");
  assert.match(zotero.update_url, /^https:\/\//);
});

test("manifest and package versions match", () => {
  assert.equal(manifest.version, packageMetadata.version);
});

test("manifest targets the installed Zotero 9 major version", () => {
  const zotero = manifest.applications.zotero;
  assert.equal(zotero.strict_min_version, "9.0");
  assert.equal(zotero.strict_max_version, "9.*");
});

test("preference pane source is a raw XUL fragment, not a complete XML document", () => {
  const panePath = path.join(__dirname, "..", "addon", "preferences.xhtml");
  const pane = fs.readFileSync(panePath, "utf8").trim();
  assert.doesNotMatch(pane, /^<\?xml/);
  assert.doesNotMatch(pane, /<\/?fragment\b/);
  assert.match(pane, /^<vbox\b/);
  assert.match(pane, /id="zotero-prefpane-reader-tool-shortcuts"/);
});
