#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SDK_ROOT=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
JAVA_ROOT=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export JAVA_HOME="$JAVA_ROOT"
export PATH="$JAVA_ROOT/bin:$PATH"
BUILD_TOOLS="$SDK_ROOT/build-tools/35.0.0"
ANDROID_JAR="$SDK_ROOT/platforms/android-35/android.jar"
OUT="$PROJECT_DIR/build/manual"
GEN="$OUT/generated"
CLASSES="$OUT/classes"
COMPILED="$OUT/compiled"
APK_UNSIGNED="$OUT/shipment-scanner-unsigned.apk"
APK_ALIGNED="$OUT/shipment-scanner-aligned.apk"
APK_FINAL="$PROJECT_DIR/shipment-scanner-debug.apk"

rm -rf "$OUT"
mkdir -p "$GEN" "$CLASSES" "$COMPILED"

find "$PROJECT_DIR/app/src/main/res" -type f -print0 | xargs -0 "$BUILD_TOOLS/aapt2" compile -o "$COMPILED"
"$BUILD_TOOLS/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$PROJECT_DIR/app/src/main/AndroidManifest.xml" \
  --java "$GEN" \
  --min-sdk-version 29 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name 1.0.0 \
  -o "$APK_UNSIGNED" \
  "$COMPILED"/*.flat

find "$PROJECT_DIR/app/src/main/java" "$GEN" -name '*.java' -print0 \
  | xargs -0 "$JAVA_ROOT/bin/javac" -encoding UTF-8 -source 8 -target 8 -Xlint:all,-options -cp "$ANDROID_JAR" -d "$CLASSES"

mkdir -p "$OUT/dex"
(cd "$CLASSES" && zip -q -r "$OUT/classes.jar" .)
"$BUILD_TOOLS/d8" --min-api 29 --lib "$ANDROID_JAR" --output "$OUT/dex" "$OUT/classes.jar"
(cd "$OUT/dex" && zip -q -u "$APK_UNSIGNED" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$APK_UNSIGNED" "$APK_ALIGNED"

KEYSTORE="$PROJECT_DIR/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  "$JAVA_ROOT/bin/keytool" -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=ImaxProm,C=RU" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android --out "$APK_FINAL" "$APK_ALIGNED"
"$BUILD_TOOLS/apksigner" verify --verbose "$APK_FINAL"
echo "$APK_FINAL"
