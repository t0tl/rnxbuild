#!/bin/bash
#
# Deploy fixture-01-bare's prebuilt binary artifacts from the staging dir
# (`binary-artifacts/`, committed to git) into `node_modules/` where the
# CocoaPods build expects them.
#
# Run this AFTER any `npm install` / `pnpm install` (which wipes node_modules
# and regenerates it from package.json, losing any artifacts we'd placed there).
#
# Mirrors what `scripts/refresh-mac-artifacts.sh` produces on a Mac. Idempotent.

set -euo pipefail

FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="${FIXTURE_DIR}/binary-artifacts"

if [[ ! -d "$ARTIFACTS_DIR" ]]; then
  echo "error: $ARTIFACTS_DIR does not exist — run scripts/refresh-mac-artifacts.sh on a Mac first" >&2
  exit 1
fi

# ExpoModulesJSI: replace the create-stub-xcframework.sh output with the real
# xcframework from the staging dir.
SRC="${ARTIFACTS_DIR}/expo-modules-jsi/apple/Products/ExpoModulesJSI.xcframework"
DST_DIR="${FIXTURE_DIR}/node_modules/expo-modules-jsi/apple/Products"
if [[ ! -d "$SRC" ]]; then
  echo "error: $SRC missing — staging dir is incomplete" >&2
  exit 1
fi
mkdir -p "$DST_DIR"
rm -rf "${DST_DIR}/ExpoModulesJSI.xcframework"
cp -R "$SRC" "${DST_DIR}/"
echo "[deploy] Installed ExpoModulesJSI.xcframework into ${DST_DIR}"
