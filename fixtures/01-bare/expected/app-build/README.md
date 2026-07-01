# app-build goldens

Captured on macOS 26.5.1 / Xcode 26.5 by running:

```bash
cd fixtures/01-bare/ios
xcodebuild -workspace 01bare.xcworkspace -scheme 01bare \
  -configuration Debug -sdk iphoneos -arch arm64 \
  -derivedDataPath /tmp/appbuild/derived \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO ONLY_ACTIVE_ARCH=YES \
  build
```

Build succeeded. Produced `01bare.app` (82 MB total) with the structure captured
below. These goldens are the authoritative reference for `@rnxbuild/linker`
and `@rnxbuild/app-bundler` (Plan-3-endgame).

## Files

- **`xcodebuild.full.log`** — entire 3MB build log from xcodebuild. Contains
  per-target build phases, compilation invocations, link commands. The grep-
  friendly source of truth.
- **`01bare.debug.build-settings.txt`** — `xcodebuild -showBuildSettings` for
  the main `01bare` target (Debug × iphoneos). Complement to the per-pod-target
  goldens in `../build-settings/`.

### Link argv (the linker's spec)

- **`ld-01bare-main.txt`** — `clang` link invocation that produces the main
  `01bare` Mach-O executable. ~600 lines wrapped on one line — has the
  `-L`/`-F`/`-l`/`-rpath`/`-sectcreate` flags rnxbuild's linker must reproduce.
- **`ld-01bare-debug-dylib.txt`** — link invocation for `01bare.debug.dylib`
  (Xcode 16+'s Previews infrastructure). Contains the user's actual code; the
  main executable is a small stub that loads this.
- **`ld-01bare-preview-dylib.txt`** — link invocation for the Preview's
  `__preview.dylib`. Smaller subset.
- **`01bare.LinkFileList`** — list of `.o` files fed to the linker for the
  main target. 4 entries: `01bare_vers.o`, `AppDelegate.o`,
  `ExpoModulesProvider.o`, `GeneratedAssetSymbols.o`.
- **`01bare-ExecutorLinkFileList-normal-arm64.txt`** — file list for the
  executor binary.
- **`01bare-DebugDylibPath-normal-arm64.txt`** /
  **`01bare-DebugDylibInstallName-normal-arm64.txt`** — path + install-name
  blobs embedded into the main binary via `-sectcreate __TEXT __debug_dylib`
  and `__TEXT __debug_instlnm`. Required for the Previews loader to find the
  user-code dylib at runtime.

### Bundle structure (the app-bundler's spec)

- **`01bare.app/`** — the produced `.app` directory minus heavy Mach-O binaries
  (the main executable, debug dylib, preview dylib, React.framework binary,
  ReactNativeDependencies.framework binary, hermesvm.framework binary). Each
  removed binary's parent dir is preserved so app-bundler tests can assert
  on the directory shape without committing ~80MB of binaries.
- **`01bare.app.file-list.txt`** — `find 01bare.app -type f` output BEFORE
  binary removal. The authoritative list of what files a successful bundle
  contains, 36 entries.
- **`Info.plist.bin`** / **`Info.plist.xml`** — the main app's `Info.plist`,
  in both binary plist (what xcodebuild produced) and XML (human-readable).
- **`React.framework-Info.plist.{bin,xml}`** — sample embedded framework's
  Info.plist; pattern for the other two embedded frameworks (ReactNativeDeps,
  hermesvm) is structurally similar.

## What's missing here (intentionally)

- **Per-target compile argv (swiftc/clang)** — modern Xcode 16+ runs compiles
  via XCBuild, which doesn't print each invocation to stdout. To capture
  those we'd need `-resultBundlePath` + `xcresulttool` walking, which the
  current capture scripts skip. Future work.
- **The actual Mach-O binaries** — see binary deletion list above. ~75MB
  saved by not committing them.

## Refreshing

```bash
# On a Mac with this fixture's whole state:
cd fixtures/01-bare
./scripts/refresh-mac-artifacts.sh           # binary artifacts + per-pod build-settings
# To recapture app-build goldens too: re-run capture-app-build-goldens.sh
# (TBD — currently scripted ad-hoc; commit will follow once stable).
```

## Cross-platform path notes

The captures embed Mac paths (`/Users/temp/fixture/...`,
`/tmp/appbuild/derived/...`) wherever xcodebuild substituted absolutes during
its run. When wiring goldens into Linux integration tests, strip the
prefix and compare relative paths, or use path-substitution maps that map
Mac paths → Linux fixture paths.
