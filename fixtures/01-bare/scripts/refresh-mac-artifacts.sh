#!/bin/bash
#
# Rebuild fixture-01-bare's prebuilt binary artifacts on a Mac.
#
# Why: a few transitive deps ship as `.xcframework`s that production CocoaPods
# builds on macOS via `xcodebuild -create-xcframework`. The bare fixture
# stamps `touch`-based stubs on Linux (see workaround #3 in BUILD-NOTES.md),
# which CocoaPods accepts at install time but swiftc rejects at compile time
# (no swiftmodule, no headers, no modulemap). This script rebuilds the
# real artifacts on a Mac and stages them under `fixtures/01-bare/binary-artifacts/`
# so `setup-linux-build-env.sh` can copy them back into `node_modules/` after
# any future `npm install`.
#
# Prereqs (on the Mac):
#   - macOS with Xcode 16+ installed
#   - swift toolchain on PATH
#   - This script's own directory containing the full fixture-01-bare/ tree
#     (i.e. you scp'd or pulled the repo onto the Mac)
#
# Usage:
#   cd fixtures/01-bare
#   ./scripts/refresh-mac-artifacts.sh
#
# Output:
#   fixtures/01-bare/binary-artifacts/expo-modules-jsi/apple/Products/ExpoModulesJSI.xcframework/

set -euo pipefail

FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="${FIXTURE_DIR}/binary-artifacts"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: must run on macOS (uname=$(uname -s))" >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "error: xcodebuild not found on PATH" >&2
  exit 1
fi

cd "$FIXTURE_DIR"

# 1. Build the real ExpoModulesJSI.xcframework via the package's own script.
#    Needs PODS_ROOT for the React/JSI/Hermes headers it compiles against;
#    we already have those under ios/Pods/.
echo "[refresh] Building ExpoModulesJSI.xcframework"
export PODS_ROOT="${FIXTURE_DIR}/ios/Pods"
export RN_ROOT="${FIXTURE_DIR}/node_modules/react-native"
(cd "${FIXTURE_DIR}/node_modules/expo-modules-jsi/apple" && bash scripts/build-xcframework.sh)

# 2. Stage produced artifacts outside node_modules so they survive npm install.
mkdir -p "${ARTIFACTS_DIR}/expo-modules-jsi/apple/Products"
rm -rf "${ARTIFACTS_DIR}/expo-modules-jsi/apple/Products/ExpoModulesJSI.xcframework"
cp -R "${FIXTURE_DIR}/node_modules/expo-modules-jsi/apple/Products/ExpoModulesJSI.xcframework" \
      "${ARTIFACTS_DIR}/expo-modules-jsi/apple/Products/"

echo "[refresh] Wrote artifacts to ${ARTIFACTS_DIR}"

# 3. Recapture golden xcodebuild -showBuildSettings per target. These are
#    the authoritative settings rnxbuild's cascade is diff-tested against.
EXPECTED_DIR="${FIXTURE_DIR}/expected/build-settings"
mkdir -p "$EXPECTED_DIR"
echo "[refresh] Capturing golden build settings into ${EXPECTED_DIR}"
cd "${FIXTURE_DIR}/ios/Pods"
TARGETS=$(xcodebuild -list -project Pods.xcodeproj 2>/dev/null | \
  awk '/Targets:/{flag=1;next}/Build Configurations:/{flag=0}flag{gsub(/^[ \t]+/,"");print}' | \
  grep -v '^$')
count=0
for t in $TARGETS; do
  xcodebuild -showBuildSettings -project Pods.xcodeproj -target "$t" \
    -configuration Debug -sdk iphoneos 2>/dev/null > "${EXPECTED_DIR}/${t}.debug.txt" || true
  count=$((count + 1))
done
echo "[refresh] Wrote ${count} golden files"

echo "[refresh] Commit and push; on Linux, run scripts/deploy-mac-artifacts.sh to redeploy"
