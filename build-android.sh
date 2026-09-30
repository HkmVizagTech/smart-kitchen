#!/usr/bin/env bash
# ============================================================
#  Brandix — STEP 2: build the 4 Android APKs
#  Run from Terminal:   bash build-android.sh
#  Builds headlessly (no Android Studio GUI needed). Needs
#  Homebrew installed. You'll be asked for your Mac password
#  once (for the JDK/SDK install).
#  Run deploy-api.sh FIRST so the apps know your API URL.
# ============================================================
set -e
cd "$(dirname "$0")"

# 0) sanity: API URL must be set ------------------------------
if [ ! -f apps/booking-web/.env ]; then
  echo "!! apps/booking-web/.env not found. Run  bash deploy-api.sh  first."
  exit 1
fi
echo "==> Using $(cat apps/booking-web/.env)"

# 1) Homebrew --------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "!! Homebrew is not installed. Install it from https://brew.sh then re-run."
  exit 1
fi

# 2) JDK 17 (Android/Gradle needs exactly 17 — NOT 21/25) ------
find_jdk17() {
  local d
  for d in /Library/Java/JavaVirtualMachines/*17*/Contents/Home; do
    [ -x "$d/bin/java" ] && { echo "$d"; return 0; }
  done
  local h; h="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  if [ -n "$h" ] && "$h/bin/java" -version 2>&1 | grep -q 'version "17'; then
    echo "$h"; return 0
  fi
  return 1
}
JDK17="$(find_jdk17 || true)"
if [ -z "$JDK17" ]; then
  echo "==> Installing JDK 17 (Temurin)..."
  brew install --cask temurin@17
  JDK17="$(find_jdk17 || true)"
fi
if [ -z "$JDK17" ]; then
  echo "!! Could not locate a Java 17 JDK after install. Run: brew install --cask temurin@17"
  exit 1
fi
export JAVA_HOME="$JDK17"
export PATH="$JAVA_HOME/bin:$PATH"
echo "==> JAVA_HOME=$JAVA_HOME"
echo "==> $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
# clear any Gradle script cache compiled by the wrong JVM
rm -rf "$HOME/.gradle/caches"/*/scripts "$HOME/.gradle/caches"/*/generated-gradle-jars 2>/dev/null || true

# 3) Android command-line tools + SDK packages ----------------
if ! brew list android-commandlinetools >/dev/null 2>&1; then
  echo "==> Installing Android command-line tools..."
  brew install --cask android-commandlinetools
fi
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

echo "==> Accepting SDK licenses + installing platform/build-tools..."
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "platforms;android-35" "build-tools;35.0.0" >/dev/null

# 4) Install JS deps once -------------------------------------
echo "==> Installing project dependencies (pnpm)..."
pnpm install

# 5) Build each app's APK -------------------------------------
OUT="$(pwd)/apk-out"
mkdir -p "$OUT"
APPS="booking-web kitchen verification admin"
for app in $APPS; do
  echo ""
  echo "============================================================"
  echo " Building: $app"
  echo "============================================================"
  pushd "apps/$app" >/dev/null
  # native icons + splash from assets/icon.png
  pnpm exec capacitor-assets generate --android >/dev/null 2>&1 || pnpm exec capacitor-assets generate --android || true
  # create android/ project on first run
  if [ ! -d android ]; then
    pnpm exec cap add android
  fi
  # The Capgo OTA plugin needs minSdk 23 + a newer compile/target SDK than
  # Capacitor's defaults — patch the generated gradle vars (idempotent).
  VARS="android/variables.gradle"
  if [ -f "$VARS" ]; then
    sed -i '' -E 's/minSdkVersion = [0-9]+/minSdkVersion = 23/' "$VARS"
    sed -i '' -E 's/compileSdkVersion = [0-9]+/compileSdkVersion = 35/' "$VARS"
    sed -i '' -E 's/targetSdkVersion = [0-9]+/targetSdkVersion = 35/' "$VARS"
  fi
  # build the web bundle + sync + assemble debug APK
  pnpm run build
  pnpm exec cap sync android
  ( cd android && ./gradlew assembleDebug )
  APK="android/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$APK" ]; then
    cp "$APK" "$OUT/${app}.apk"
    echo "   -> $OUT/${app}.apk"
  else
    echo "   !! APK not found for $app"
  fi
  popd >/dev/null
done

echo ""
echo "============================================================"
echo " DONE. APKs are in:  $OUT"
ls -lh "$OUT" 2>/dev/null | awk 'NR>1{print "   "$5"  "$9}'
echo ""
echo " Install on an Android phone:"
echo "  - send/transfer the .apk to the phone (or host + share a link)"
echo "  - tap it, allow 'install unknown apps', then Install."
echo "============================================================"
