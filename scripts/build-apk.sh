#!/bin/sh
#
# Build the KAVACH Android APK, from a clean machine.
#
# The web app builds anywhere. The APK does not, because it needs a native
# toolchain that most CI images and most laptops do not have: a JDK 21 and an
# Android SDK with platform 36 and build-tools 36. This script installs both if
# they are missing, then does the actual build.
#
# It is here because the alternative is a wiki page of commands that rot. The
# GitHub Actions workflow in .github/workflows/android-apk.yml does the same
# thing on a runner that already has the toolchain; this is for a machine that
# does not.
#
# Usage:
#   sh scripts/build-apk.sh
#
# Result:
#   KAVACH-<version>-debug.apk  in the project root
#
# Requires: curl, unzip, and either apt-get (Debian/Ubuntu) or a JDK 21 you
# already have. Everything is installed under $TOOLCHAIN_DIR, which defaults to
# /opt/kavach-toolchain — outside the repository, because it is about 1.5 GB of
# toolchain that has no business in a git tree or in a deploy upload.
#
# Needs root if it has to install the JDK or write to /opt. On a machine where
# you are not root, set TOOLCHAIN_DIR to somewhere you own and install a JDK 21
# yourself first.

# POSIX sh, deliberately: this runs the same way on a developer laptop, in this
# sandbox, and on a Debian CI image, and `bash` is not on all three. No arrays,
# no `local`, no `pipefail`.
set -eu

TOOLCHAIN_DIR="${TOOLCHAIN_DIR:-/opt/kavach-toolchain}"
ANDROID_SDK="$TOOLCHAIN_DIR/android-sdk"
CMDLINE_BUILD="${CMDLINE_BUILD:-12266719}"
COMPILE_SDK="android-36"
BUILD_TOOLS="36.0.0"

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# -- 1. A JDK -----------------------------------------------------------------
#
# Capacitor 8 targets Java 21, and Android Gradle Plugin 8.13 wants 17 or newer.
# 21 is what Capacitor's own toolchain is tested against.
if ! command -v javac >/dev/null 2>&1 || [ "$(javac -version 2>&1 | cut -d. -f1 | tr -dc 0-9)" -lt 21 ]; then
  say "Installing OpenJDK 21"
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "No apt-get, and no JDK 21 on PATH. Install one, then re-run." >&2
    exit 1
  fi
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jdk-headless
else
  say "JDK $(javac -version 2>&1) already present"
fi
JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
export JAVA_HOME

# -- 2. The Android SDK -------------------------------------------------------
if [ ! -x "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  say "Downloading the Android command-line tools"
  mkdir -p "$TOOLCHAIN_DIR"
  zip="$TOOLCHAIN_DIR/cmdline-tools.zip"
  curl -fsSL -o "$zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_BUILD}_latest.zip"
  rm -rf "$ANDROID_SDK" /tmp/kavach-ct
  mkdir -p "$ANDROID_SDK/cmdline-tools" /tmp/kavach-ct
  unzip -q "$zip" -d /tmp/kavach-ct
  mv /tmp/kavach-ct/cmdline-tools "$ANDROID_SDK/cmdline-tools/latest"
  rm -f "$zip"

  say "Accepting the SDK licences"
  # Non-interactive. Without this the install stops on a prompt and, in CI,
  # produces an SDK with no platform in it and a confusing Gradle error later.
  yes | "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
fi
export ANDROID_HOME="$ANDROID_SDK"
export PATH="$ANDROID_SDK/cmdline-tools/latest/bin:$PATH"

if [ ! -d "$ANDROID_SDK/platforms/$COMPILE_SDK" ]; then
  say "Installing platform $COMPILE_SDK, build-tools $BUILD_TOOLS and platform-tools"
  sdkmanager "platform-tools" "platforms;$COMPILE_SDK" "build-tools;$BUILD_TOOLS" >/dev/null
fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$TOOLCHAIN_DIR/gradle}"

# -- 3. The web app, into the native project ----------------------------------
#
# One build, not two. The APK is the same bundle as the deployed site apart from
# the backend URL, which Vite inlines at build time.
say "Building the web app"
bun run build

# Source maps are a debugging aid for a browser. There is no devtools on a
# handset, so shipping them inside the APK is 6 MB of nothing — and on this
# project it was more than that: three.js and MindAR produce very large maps.
#
# Deleted from `dist/` *after* the build rather than by turning sourcemaps off,
# because the deployed site keeps them. Same bundle, same behaviour; the APK
# just does not carry a map of itself.
say "Dropping source maps from the APK payload"
find dist -name '*.map' -delete

say "Copying it into the Android project"
bunx cap sync android

# -- 4. The APK ---------------------------------------------------------------
#
# local.properties is how Gradle finds the SDK when ANDROID_HOME is not exported
# into its daemon. It is gitignored: it is a path on this machine, not a setting
# of the project.
echo "sdk.dir=$ANDROID_SDK" > android/local.properties

say "Assembling the debug APK"
#
# `clean` is not optional and not superstition.
#
# Gradle's incremental packager appends to the APK and does not always reclaim
# the space when an input shrinks. Building repeatedly while the bundle changed
# — which is what a developer does, and what a source map deletion does — left
# orphaned deflate blocks behind: the same content in the central directory,
# and a file twice the size it should be. A build that had only ever run once,
# on a clean checkout, was 5.5 MB; the same code built nine times was 10.7 MB,
# byte-for-byte the same entries.
#
# So the artefact does not depend on how many times you have built before. It
# costs about thirty seconds and it is the difference between an APK whose size
# means something and one that does not.
(cd android && ./gradlew --no-daemon clean assembleDebug)

version="$(grep -m1 '"version"' package.json | cut -d'"' -f4)"
apk="android/app/build/outputs/apk/debug/app-debug.apk"
out="KAVACH-${version}-debug.apk"
cp "$apk" "$out"

say "Done"
ls -lh "$out"
echo
echo "Install it with:  adb install -r $out"
echo "or copy it to the handset and open it there (enable developer options first)."
echo
echo "The deployed web app is unaffected: source maps are only removed from the"
echo "copy that goes into the APK."
