# rnxbuild

Linux-native build tool for React Native + Expo iOS apps. **Research-grade spike — not
production.** See [the design spec](../docs/superpowers/specs/2026-06-27-rnxbuild-design.md)
in the parent `natively-dev` repo for the full motivation and architecture.

## Status

**Plan 3 endgame (linker + app-bundler wired) — empirical milestone.** Parses Xcode workspaces, resolves the full build-settings cascade, cross-compiles Swift/Obj-C/C++ to arm64 Mach-O objects, plans + drives a per-target build graph, and now has linker/app-bundler packages wired through orchestrator post-build. Real `01-bare` fixture runs compile all 19 planned targets and produces `01bare.app` on this Linux host using the Swift SDK artifactbundle linker/runtime. On macOS/Xcode 26.5 the same integration test produces `01bare.app` from a relocated checkout whose fixture still contains stale captured absolute paths. Full breakdown in [`KNOWN-BROKEN.md`](./KNOWN-BROKEN.md).

## Quickstart

```bash
pnpm install
pnpm test                # unit + integration tests
pnpm rnxbuild doctor     # diagnose the local toolchain
```

## What works today

- `@rnxbuild/logger` — structured pino logger.
- `@rnxbuild/plist` — XML + binary plist round-trip.
- `@rnxbuild/workspace-parser` — parses `.xcworkspace`, `.pbxproj`, `.xcconfig`. Includes `loadXcconfigChain` (recursive #include with cycle detection), `targetSourceFiles` (PBX file-reference resolution), `resolveFileReferencePath`.
- `@rnxbuild/build-settings` — `$(VAR)` substitution, `$(inherited)`, conditional
  selectors (`[sdk=...]` / `[arch=...]` / `[config=...]`), full
  xcconfig→project→target→configuration cascade.
- `@rnxbuild/swift-compiler` — translates resolved Xcode build settings to swiftc argv via `buildSwiftcArgs`, drives `swift build --swift-sdk arm64-apple-ios` against a synthesized SwiftPM package, produces arm64 Mach-O `.o` files. Supports `-emit-objc-header` for `<Mod>-Swift.h` bridging plus `swiftModuleSearchPaths` for cross-target swiftmodule visibility.
- `@rnxbuild/clang-compiler` — translates resolved Xcode build settings to clang argv via `buildClangArgs`, drives clang per-source. Handles Obj-C / Obj-C++ / C / C++ compilation to per-source `.o` files.
- `@rnxbuild/pod-resolver` — CocoaPods-aware pure-async path rewriters: `rewriteModulemapPaths` (Wall C — `-fmodule-map-file=` paths to canonical Target Support Files), `rewriteFrameworkSearchPaths` (Wall D — `FRAMEWORK_SEARCH_PATHS` entries to on-disk `.xcframework/<arch-slice>/` directories), and `rewriteRelocatedAbsolutePaths` (rebases stale captured `ios/Pods`, `ios`, and `node_modules` absolute paths to the current checkout when the destination exists).
- `@rnxbuild/target-graph` — topological ordering with cycle detection, plus `topologicalTiers` for parallel-within / sequential-across scheduling.
- `@rnxbuild/build-planner` — `buildPlan()` walks both xcodeproj's, runs the cascade per target, applies pod-resolver rewriters, partitions sources by language, derives dep edges. Produces a `BuildPlan` consumed by the orchestrator.
- `@rnxbuild/linker` — `buildLinkerArgs` translates resolved Xcode settings + per-target object files into a clang link argv matching the fixture ld golden modulo punted Previews/LTO/dependency-info flags. `createLinker.link` invokes clang through an injected runner, materializes the `.o` filelist into a temp file, and on Linux-hosted Swift SDK artifactbundles points clang at the artifactbundle `ld64.lld`, Swift runtime, SDK framework, and compiler-runtime paths needed for iOS links.
- `@rnxbuild/app-bundler` — `synthesizeInfoPlist` derives an Info.plist dictionary from settings (Xcode defaults + `INFOPLIST_KEY_*` convention + user merge). `bundleApp` assembles `<App>.app/` directories with binary, Info.plist, PkgInfo, resources, asset catalogs, storyboards, resource bundles, privacy manifests, and embedded frameworks.
- `@rnxbuild/orchestrator` — `orchestrate(plan, opts)` walks targets in topological tiers (parallel within tier, sequential across), dispatches per target to swift-compiler then clang-compiler with `<Mod>-Swift.h` bridging, then invokes linker + app-bundler post-build for app targets when compilation succeeds. Fail-fast on first tier failure with structured `BuildResult`.
- `@rnxbuild/xtool-bridge` — subprocess wrapper for xtool.
- `@rnxbuild/diagnostic` + `@rnxbuild/cli` — `rnxbuild doctor` command.
- Fixture `01-bare` — a fresh Expo SDK 56 / RN 0.85 project committed with text-only
  Pods snapshot, exercised by integration tests that parse the workspace + main
  project successfully.

## What doesn't work yet

- Golden-snapshot resolver test is `pending` until we run
  `scripts/capture-golden-snapshots.sh 01-bare` on a Mac with Xcode.

## Repo layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## License

MIT. See [`LICENSE`](./LICENSE).
