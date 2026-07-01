#!/usr/bin/env bash
# Run THIS on a Mac with Xcode installed. It captures golden build-settings
# snapshots from real `xcodebuild` and writes them to fixtures/<fixture>/expected/.
# These snapshots are what the Linux integration tests compare against.
#
# Usage:
#   bash scripts/capture-golden-snapshots.sh <fixture-name>
#
# Example:
#   bash scripts/capture-golden-snapshots.sh 01-bare

set -euo pipefail

FIXTURE="${1:?Usage: $0 <fixture-name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_DIR="$ROOT/fixtures/$FIXTURE"
EXPECTED_DIR="$FIXTURE_DIR/expected"

if [[ ! -d "$FIXTURE_DIR/ios" ]]; then
  echo "Fixture $FIXTURE has no ios/ directory; run prebuild first." >&2
  exit 1
fi

mkdir -p "$EXPECTED_DIR"

WORKSPACE=$(ls "$FIXTURE_DIR/ios"/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)

echo "Capturing build settings for workspace=$WORKSPACE scheme=$SCHEME (Debug, iphoneos)…"

xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -sdk iphoneos \
  -showBuildSettings \
  -json > "$EXPECTED_DIR/main-app-build-settings.raw.json"

node -e "
const fs = require('fs');
const all = JSON.parse(fs.readFileSync('$EXPECTED_DIR/main-app-build-settings.raw.json', 'utf8'));
const main = all.find((t) => t.target === '$SCHEME');
if (!main) { console.error('Could not find target $SCHEME'); process.exit(1); }
fs.writeFileSync(
  '$EXPECTED_DIR/main-app-build-settings.json',
  JSON.stringify(main.buildSettings, null, 2),
);
fs.unlinkSync('$EXPECTED_DIR/main-app-build-settings.raw.json');
"

echo "Wrote $EXPECTED_DIR/main-app-build-settings.json"
