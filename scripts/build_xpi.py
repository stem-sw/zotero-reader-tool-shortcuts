#!/usr/bin/env python3
import json
import hashlib
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADDON = ROOT / "addon"
CORE = ROOT / "src" / "core.js"
DIST = ROOT / "dist"
UPDATE_JSON = ROOT / "update.json"
REPOSITORY = "stem-sw/zotero-reader-tool-shortcuts"

manifest = json.loads((ADDON / "manifest.json").read_text(encoding="utf-8"))
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
version = manifest["version"]
if package.get("version") != version:
    raise SystemExit("package.json version does not match manifest.json")
output = DIST / f"reader-tool-shortcuts-{version}.xpi"
zotero_target = manifest.get("applications", {}).get("zotero", {})
for field in ("id", "update_url", "strict_min_version", "strict_max_version"):
    if not zotero_target.get(field):
        raise SystemExit(f"Missing applications.zotero.{field}")

required = [
    "manifest.json",
    "bootstrap.js",
    "prefs.js",
    "preferences.xhtml",
    "preferences.js",
    "preferences.css",
]
for filename in required:
    if not (ADDON / filename).is_file():
        raise SystemExit(f"Missing add-on file: {filename}")
if not CORE.is_file():
    raise SystemExit("Missing src/core.js")

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir(parents=True)

with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for filename in required:
        info = zipfile.ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (ADDON / filename).read_bytes(), compresslevel=9)
    info = zipfile.ZipInfo("core.js", date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, CORE.read_bytes(), compresslevel=9)

with zipfile.ZipFile(output) as archive:
    names = set(archive.namelist())
    expected = set(required) | {"core.js"}
    if names != expected:
        raise SystemExit(f"Unexpected XPI contents: {sorted(names)}")
    packed_manifest = json.loads(archive.read("manifest.json"))
    packed_target = packed_manifest["applications"]["zotero"]
    if packed_target["strict_min_version"] != "9.0":
        raise SystemExit("XPI is not marked for Zotero 9")
    if packed_target["update_url"] != zotero_target["update_url"]:
        raise SystemExit("Packed update_url does not match source manifest")

sha512 = hashlib.sha512(output.read_bytes()).hexdigest()
update_data = {
    "addons": {
        zotero_target["id"]: {
            "updates": [
                {
                    "version": version,
                    "update_link": (
                        f"https://github.com/{REPOSITORY}/releases/download/"
                        f"v{version}/{output.name}"
                    ),
                    "update_hash": f"sha512:{sha512}",
                    "applications": {
                        "zotero": {
                            "strict_min_version": zotero_target["strict_min_version"],
                            "strict_max_version": zotero_target["strict_max_version"],
                        }
                    },
                }
            ]
        }
    }
}
UPDATE_JSON.write_text(
    json.dumps(update_data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

print(output)
print(UPDATE_JSON)
