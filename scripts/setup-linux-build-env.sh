#!/usr/bin/env bash
# Set up Linux workarounds needed by Expo's `pod install` (which assumes macOS).
# Idempotent — safe to re-run. Requires sudo for the /usr/local/bin stubs.
#
# Workarounds installed:
#   1. /usr/local/bin/xcodebuild — stub returning "Xcode 16.2" so react-native's
#      Xcode-version probe in its CocoaPods scripts passes.
#   2. /usr/local/bin/command — wrapper delegating to `which`, because Ruby
#      backtick spawning bypasses the shell and shell-builtin `command` isn't
#      available as an executable on Linux.
#
# A third workaround — patching `node_modules/expo-modules-jsi/apple/scripts/
# create-stub-xcframework.sh` to use `touch` instead of `clang -dynamiclib` —
# is applied PER-FIXTURE when needed (lives in fixtures/<name>/scripts/patch-
# expo-modules-jsi.sh, applied by that fixture's regeneration recipe).

set -euo pipefail

XCODEBUILD_STUB=/usr/local/bin/xcodebuild
COMMAND_SHIM=/usr/local/bin/command

echo "Installing xcodebuild stub at $XCODEBUILD_STUB"
sudo tee "$XCODEBUILD_STUB" >/dev/null <<'EOF'
#!/bin/bash
# Stub returning a recent Xcode version. react-native's CocoaPods scripts call
# `xcodebuild -version` and parse the second line for the Build version.
case "${1:-}" in
  -version)
    echo "Xcode 16.2"
    echo "Build version 16C5032a"
    ;;
  *)
    echo "xcodebuild stub: $* (no-op)" >&2
    exit 0
    ;;
esac
EOF
sudo chmod +x "$XCODEBUILD_STUB"

echo "Installing command shim at $COMMAND_SHIM"
sudo tee "$COMMAND_SHIM" >/dev/null <<'EOF'
#!/bin/bash
# Linux doesn't ship `command` as an executable (it's a shell builtin).
# CocoaPods/Ruby backticks call `command -v <name>` to test for executables;
# this shim translates to `which`.
if [[ "${1:-}" == "-v" ]]; then
  shift
  which "$@"
else
  exec "$@"
fi
EOF
sudo chmod +x "$COMMAND_SHIM"

echo
echo "Linux build-env setup complete."
echo "Test with:"
echo "  xcodebuild -version    # should print 'Xcode 16.2'"
echo "  command -v ls          # should print '/bin/ls' (or similar)"
