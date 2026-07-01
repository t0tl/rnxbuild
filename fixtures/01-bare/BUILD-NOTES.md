# Fixture: 01-bare

The canary fixture. Fresh `npx create-expo-app@latest --template blank-typescript`, no
plugins, no extra dependencies beyond Expo's defaults.

## What this fixture tests

- The simplest possible Expo project still pulls in ~50 transitive Pods (React, Hermes,
  ExpoModulesCore, expo-font, etc.) — so even "bare" exercises the CocoaPods integration.
- The main app target is a single Swift `AppDelegate` + Obj-C++ glue from React Native.
- Asset catalog has only the default icon + splash; no custom variants.
- No custom Pods, no custom native modules, no extensions.

## What it does NOT test

- See `KNOWN-BROKEN.md` for the explicit unsupported list.

## How to regenerate

```bash
cd fixtures
rm -rf 01-bare
npx create-expo-app@latest 01-bare --template blank-typescript --no-install
cd 01-bare
# edit app.json to set expo.ios.bundleIdentifier = dev.rnxbuild.fixture01
# edit .gitignore to remove "/ios" from "generated native folders" section
npm install
npx expo prebuild --platform ios --clean --no-install
cd ios && pod install && cd ..
```

## Linux-specific notes

Run `bash scripts/setup-linux-build-env.sh` ONCE before re-generating the fixture to install workarounds #1 and #2 below; workaround #3 must be re-applied after every `npm install`.

This fixture was generated on Linux (not macOS). Three workarounds were required for
`pod install` to succeed:

1. **`xcodebuild` stub** — `react-native` calls `xcodebuild -version` to check Xcode ≥
   16.1. A stub at `/usr/local/bin/xcodebuild` returns `"Xcode 16.2"`.

2. **`command` wrapper** — Ruby backtick calls `command -v ccache` which fails on Linux
   because `command` is a shell builtin, not an executable. A wrapper at
   `/usr/local/bin/command` delegates to `which`.

3. **`clang -dynamiclib` fallback** — `ExpoModulesJSI`'s `create-stub-xcframework.sh`
   uses `clang -dynamiclib` (macOS-only) to create a stub xcframework. The script was
   patched to fall back to `touch` on Linux since CocoaPods only checks that the stub
   binary file exists, not that it's a valid Mach-O dylib. The stub is enough for
   `pod install`, but swiftc rejects it at compile time (no Headers/, no
   Modules/<Name>.swiftmodule/). See "Prebuilt artifacts staging" below.

## Prebuilt artifacts staging

A few transitive deps ship as `.xcframework`s that production CocoaPods builds on
macOS via `xcodebuild -create-xcframework`. We cannot reproduce that on Linux (no
xcodebuild), so we stage the real artifacts under `binary-artifacts/` (committed to
git, outside `node_modules/` so they survive `npm install`) and copy them into the
expected `node_modules/<pkg>/...` location via `scripts/deploy-mac-artifacts.sh`.

Workflow:
- **On a Mac (one-time / when a transitive dep updates):**
  ```bash
  cd fixtures/01-bare
  ./scripts/refresh-mac-artifacts.sh   # builds real xcframework via xcodebuild
  git add binary-artifacts/ && git commit -m "fixture(01-bare): refresh prebuilt artifacts"
  git push
  ```
- **On Linux (after every npm/pnpm install):**
  ```bash
  cd fixtures/01-bare
  ./scripts/deploy-mac-artifacts.sh    # copies staged artifacts into node_modules
  ```

Currently staged:
- `ExpoModulesJSI.xcframework` (ios-arm64 + ios-arm64_x86_64-simulator slices, ~21 MB)
  — required for `ExpoModulesCore` to satisfy `import ExpoModulesJSI`.

## Golden snapshots (expected/build-settings/)

`expected/build-settings/<TargetName>.debug.txt` contains the output of
`xcodebuild -showBuildSettings -project Pods.xcodeproj -target <TargetName>
-configuration Debug -sdk iphoneos` captured on macOS 26.5.1 / Xcode 26.5 from
this same fixture. 91 files, one per native target. These are the authoritative
"what xcodebuild thinks the resolved settings should be" — diff-tested against
`@rnxbuild/build-settings`'s `resolveTargetSettings` output in the integration
suite.

Refresh: re-run `./scripts/refresh-mac-artifacts.sh` (extend it to also run
the capture script for changed targets) on a Mac, commit the diff.

## Binary artifact exclusions

React Native 0.85+ ships prebuilt XCFrameworks (ReactNativeCore, ReactNativeDependencies,
hermes-engine). These total ~1.1 GB and cannot be committed to git. The `ios/.gitignore`
explicitly excludes the binary-heavy pod directories while keeping the text files needed
for parsing tests (`Pods.xcodeproj`, `Target Support Files`, `Local Podspecs`,
`Manifest.lock`).

Excluded from git (>1 GB total):
- `Pods/React-Core-prebuilt/` — 618 MB (React.xcframework binary)
- `Pods/ReactNativeCore-artifacts/` — 121 MB (tarballs)
- `Pods/ReactNativeDependencies/` — 119 MB (xcframework binary)
- `Pods/ReactNativeDependencies-artifacts/` — 28 MB (tarballs)
- `Pods/hermes-engine/` — 97 MB (Hermes binary destroot)
- `Pods/hermes-engine-artifacts/` — 51 MB (tarballs)
- `Pods/Headers/` — 38 MB (header symlinks, redundant)

## Versions captured

- Expo SDK: 56.0.12
- React Native: 0.85.3
- CocoaPods: 1.16.2
- Capture date: 2026-06-27
