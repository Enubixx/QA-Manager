#!/usr/bin/env bash
# Builds the QA Tester debug APK on the Cloudtop and (optionally) installs it on the phone
# connected to your Mac via the adb tunnel (ssh -R 5038:localhost:5037 ...).
#   native/android/build-apk.sh            # build only
#   native/android/build-apk.sh --install  # build + adb install -r
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/opt/jdk-21* 2>/dev/null | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$PATH"

# 1. Web bundle (uses .env.local - same Supabase project as the live app)
npm run build

# 2. Sync into the Capacitor Android project and apply our native pieces (android/ is gitignored)
npx cap sync android
JAVA_DIR=android/app/src/main/java/com/qamanager/mobile
cp native/android/DeviceBuildsPlugin.java "$JAVA_DIR/DeviceBuildsPlugin.java"
cp native/android/MainActivity.java "$JAVA_DIR/MainActivity.java"
python3 native/android/patch_android.py

# 3. Build (Cloudtop SDK path, without touching the Mac's local.properties permanently)
cp android/local.properties /tmp/qa_local.properties.bak 2>/dev/null || true
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
(cd android && ./gradlew --no-daemon -q assembleDebug)
cp /tmp/qa_local.properties.bak android/local.properties 2>/dev/null || true
APK="android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p dist-apk && cp "$APK" dist-apk/QA_Tester_debug.apk
echo "APK: $ROOT/dist-apk/QA_Tester_debug.apk"

if [[ "${1:-}" == "--install" ]]; then
  export ADB_SERVER_SOCKET="${ADB_SERVER_SOCKET:-tcp:localhost:5038}"
  adb install -r dist-apk/QA_Tester_debug.apk
fi
