"""Idempotently patches the gitignored Capacitor android/ project for QA Tester:
- app name "QA Tester"
- package visibility for Glasses Core / Glasses Companion (Android 11+ <queries>)
- ML Kit text recognition dependency (bundled, on-device model)
- release version: versionCode 10 / versionName "2.8.0"
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2] / "android"

strings = ROOT / "app/src/main/res/values/strings.xml"
s = strings.read_text()
s = re.sub(r'(<string name="app_name">)[^<]*(</string>)', r'\1QA Tester\2', s)
s = re.sub(r'(<string name="title_activity_main">)[^<]*(</string>)', r'\1QA Tester\2', s)
strings.write_text(s)

manifest = ROOT / "app/src/main/AndroidManifest.xml"
m = manifest.read_text()
if "com.google.android.glasses.core" not in m:
    queries = (
        "    <queries>\n"
        "        <package android:name=\"com.google.android.glasses.core\" />\n"
        "        <package android:name=\"com.google.android.glasses.companion\" />\n"
        "    </queries>\n\n"
    )
    m = m.replace("    <!-- Permissions -->", queries + "    <!-- Permissions -->", 1)
    manifest.write_text(m)

gradle = ROOT / "app/build.gradle"
g = gradle.read_text()
dep = "    implementation 'com.google.mlkit:text-recognition:16.0.1'\n"
if "com.google.mlkit:text-recognition" not in g:
    g = g.replace("    implementation project(':capacitor-android')\n", "    implementation project(':capacitor-android')\n" + dep, 1)
# Keep in sync with APP_VERSION_CODE / APP_VERSION_NAME in src/constants.ts.
g = re.sub(r'versionCode \d+', 'versionCode 10', g, count=1)
g = re.sub(r'versionName "[^"]*"', 'versionName "2.8.0"', g, count=1)
gradle.write_text(g)

print("android/ patched: app name, <queries>, ML Kit dependency, versionCode 10 / versionName 2.8.0")
