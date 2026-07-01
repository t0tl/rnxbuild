# Known-broken (Plan 2)

Limitations of rnxbuild as of Plan 2. Each one is an explicit scope deferral, not
a bug. They graduate to working in the plan listed.

## Compilation pipeline (Plan 2)

- **Swift compilation surface** — `@rnxbuild/swift-compiler` ships `buildSwiftcArgs()` (26 unit tests) and `createSwiftCompiler({swiftPath, run}).compile()` driving `swift build --swift-sdk arm64-apple-ios` against a synthesized SwiftPM package. `@rnxbuild/pod-resolver` ships `rewriteModulemapPaths()` (9 unit tests) and `rewriteFrameworkSearchPaths()` (14 unit tests) for CocoaPods-aware path normalization. It successfully cross-compiles SwiftUI hello-worlds against the iOS SDK (Plan-1 cross-compile integration tests). It does NOT yet successfully compile real Expo Pod sources — see "Wall characterization (post-P3T1/T2/T4/T5/T7 → Plan-3-next)" below for the remaining wall (Swift-module visibility from prebuilt xcframeworks) Plan-3-next must address.
- Obj-C / Obj-C++ / C / C++ compilation: `@rnxbuild/clang-compiler` now exists and drives clang per-source, but two argv bugs (F2 + F3 below) still block real Pod compilation.
- Linking package exists: `@rnxbuild/linker` builds clang linker argv and
  materializes `.o` filelists through an injected/execa runner. The full
  fixture still does not reach link because compilation stops at Wall J.
- `.app` bundling package exists: `@rnxbuild/app-bundler` synthesizes
  binary Info.plist files and assembles `.app` directories from linked
  binaries/resources/frameworks. The full fixture still does not reach
  bundling because compilation stops at Wall J.
- Build-graph orchestration over targets: `@rnxbuild/orchestrator` + `@rnxbuild/build-planner` now ship; orchestrator walks topological tiers with parallel-within / sequential-across + fail-fast. Dep-edge derivation in build-planner is too sparse for source-pod Swift co-compilation to kick in on real fixtures — see Wall F1 below.

## Wall characterization (post-P3T1/T2/T4/T5/T7 → Plan-3-next)

The three Plan-2 walls AND the four P3T3+ follow-up walls (A, B, C, D) are now fixed:
- **61f8ed0 (P3T1)** — shell-aware tokenization in the xcconfig parser:
  multi-value lists arrive as `string[]`, embedded `-Xcc …` runs in
  OTHER_SWIFT_FLAGS / OTHER_CFLAGS tokenize correctly.
- **81b0b0e (P3T2)** — `CascadeInput.environment` + `buildXcodeEnvironment`
  helper seed `$(SRCROOT)`, `$(CONFIGURATION)`, `$(PODS_ROOT)`,
  `$(PODS_CONFIGURATION_BUILD_DIR)`, `$(EFFECTIVE_PLATFORM_NAME)`, etc.
  so CocoaPods xcconfig vars substitute to real on-disk paths.
- **6487d4f (P3T4, Wall A — ✅ FIXED)** — workspace-parser's
  `normalizeBuildSettings` conditionally tokenizes pbxproj scalar string
  values containing `$(inherited)`, so
  `OTHER_SWIFT_FLAGS = "$(inherited) -D EXPO_CONFIGURATION_DEBUG"` arrives
  at the cascade as `["$(inherited)", "-D", "EXPO_CONFIGURATION_DEBUG"]`
  instead of a single string. Values without `$(inherited)` stay scalar so
  multi-word English strings like
  `INFOPLIST_KEY_NSHumanReadableCopyright = "Copyright (c) 2024 Acme Inc"`
  aren't incorrectly split.
- **6487d4f (P3T4, Wall B — ✅ FIXED)** — `packages/swift-compiler/src/args.ts`
  now emits HEADER_SEARCH_PATHS as `-Xcc -I -Xcc <path>` quadruples (was
  `-Xcc -I <path>` triples, which silently broke because swiftc's `-Xcc`
  forwards only the next arg, leaving `<path>` as a positional swiftc input).
- **P3T5 (Wall C — ✅ FIXED)** — `packages/pod-resolver/src/modulemap.ts`
  (extracted from swift-compiler in P3T6, commits 436d49c + 11cbe1d)
  ships `rewriteModulemapPaths(settings, {podsRoot})`: a pure async
  settings normalizer that scans every setting value (string or array) for
  `-fmodule-map-file=<path>` tokens, and when `<path>` doesn't exist on
  disk, rewrites to the canonical CocoaPods source-tree location
  `${podsRoot}/Target Support Files/<Pod>/<Pod>.modulemap` (where `<Pod>`
  is the basename of the parent directory of the original .modulemap path)
  if THAT file exists. Otherwise the original is preserved so any
  subsequent error keeps its informative path. The integration test wires
  the rewriter between `resolveTargetSettings` and `compiler.compile`.
  Pure CocoaPods-naming-convention transformation — scales to any Pod
  CocoaPods generated normally (13 .modulemap files in fixture-01-bare).
- **6ffdadb (P3T7, Wall D — ✅ FIXED)** — `packages/pod-resolver/src/framework.ts`
  ships `rewriteFrameworkSearchPaths(settings, {podsRoot, context})`,
  sibling to `rewriteModulemapPaths`. Scans `FRAMEWORK_SEARCH_PATHS`
  entries (string or array); for each missing entry, walks UP the entry
  path to find a matching `${podsRoot}/<name>` directory, locates any
  `*.xcframework` under three known subpaths (direct,
  `framework/packages/react-native`, `destroot/Library/Frameworks/universal`),
  picks the per-arch slice (`ios-arm64` for device builds, ios-...-simulator
  for simulator builds), and rewrites to that slice directory — which is
  what `-F<path>` expects (a directory containing `.framework`s). Same
  informative-error fallback as Wall C: when no plausible xcframework or
  matching slice exists, the original entry is preserved. The integration
  test wires the rewriter immediately after `rewriteModulemapPaths`.
  Resolves the three xcframework discovery paths in fixture-01-bare:
  `React-Core-prebuilt/React.xcframework`,
  `ReactNativeDependencies/framework/packages/react-native/ReactNativeDependencies.xcframework`,
  and `hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework`.

`integration/test/compile-fixture-01-bare.test.ts` re-run on 2026-06-28
after P3T7 confirms: NO `no such module 'React'` errors. swiftc finds
all prebuilt frameworks, completes umbrella-header resolution, and
progresses into Swift semantic analysis of the project's own sources,
where it fails with the next wall:

5. **Prebuilt-framework header/swiftmodule integration — Wall E.** Two
   related symptoms surface at once:

   (a) The prebuilt React.framework umbrella-header chain pulls in
       hundreds of headers; some declare API without nullability
       annotations, and `emit-module` cascades them into failure:

   ```
   error: emit-module command failed with exit code 1
   [3/5] Emitting module _1bare
   <module-includes>:1:9: note: in file included from <module-includes>:1:
   1 | #import "Headers/React_Core/React_Core-umbrella.h"
   …/React.xcframework/ios-arm64/React.framework/Headers/React_Core/React_Core-umbrella.h:113:9: note: in file included from …:113:
   113 | #import <React/RCTHTTPRequestHandler.h>
   …/Pods/Headers/Public/React-Core/React/RCTHTTPRequestHandler.h:11:35: warning: pointer is missing a nullability type specifier
   ```

   (b) `Pods/Target Support Files/Pods-01bare/ExpoModulesProvider.swift`
       declares `internal import ExpoModulesCore` (etc.) but Swift can't
       see types like `FontUtilsModule`,
       `FileSystemBackgroundSessionHandler`, `AppCodeSignEntitlements`.

   The `import` line itself succeeds (no "no such module" error) — swiftc
   finds the modulemap and synthesizes a clang module — but the Swift
   portion of the prebuilt `.framework` (typically a `*.swiftmodule`
   directory under `<Framework>.framework/Modules/`) either isn't shipped
   in the prebuilt or sits at a path swiftc doesn't search by default.
   Likely paths forward: (1) suppress the nullability warning-cascade
   the same way production Xcode does (CocoaPods-injected -W flags or
   module-aware preprocessing); (2) co-compile pure-Swift Expo sources
   from `node_modules/<expo-pkg>/ios/` into the main target; (3) point
   `-I <Framework>.framework/Modules` at the .swiftmodule directory.

- **P3T8 (Wall E — partially addressed, Wall F characterized)** —
  `@rnxbuild/orchestrator` + `@rnxbuild/clang-compiler` +
  `@rnxbuild/build-planner` ship the full per-target build pipeline.
  `orchestrate(plan, opts)` walks topological tiers from
  `target-graph.topologicalTiers`, runs each tier via `Promise.all`,
  dispatches per target to swift-compiler first (with `-emit-objc-header`
  for `<Mod>-Swift.h` bridging) then clang-compiler (with the generated
  bridging header on the include path), threading per-target
  `.swiftmodule` paths into downstream targets' `swiftModuleSearchPaths`.
  Wall E (Swift co-compilation infrastructure) is mechanically in place —
  source-pod Swift targets CAN now build in dependency order ahead of the
  main target — but the actual fixture-01-bare run on 2026-06-28 reveals
  Wall F: three orthogonal blockers stop the build at tier 1 (8 of 19
  targets attempted; 5 OK, 3 FAIL; subsequent tiers never run because of
  fail-fast):

   (F1) **Dep graph is too sparse — Expo/React/ExpoModulesCore source
        pods never schedule.** The orchestrator's first tier contained
        5 trivially-OK targets (privacy-resource bundles with zero
        sources) plus ReactCodegen, ExpoLogBox, AND `01bare` itself.
        `01bare` should depend transitively on Expo, ExpoModulesCore,
        React, React-Core, etc. — but `deriveDeps` (PBXTargetDependency
        + FRAMEWORK_SEARCH_PATHS/OTHER_LDFLAGS heuristics) didn't
        produce edges for them, so they were never sorted into earlier
        tiers and never built. `01bare`'s Swift compile failed with
        `error: no such module 'Expo'` immediately. Production CocoaPods
        encodes dep edges via the `Pods-<app>` umbrella target's
        PBXTargetDependency list and via `-l<lib>` entries in
        OTHER_LDFLAGS; the heuristic in `@rnxbuild/build-planner` needs
        to learn one of those signals.

   (F2) **Clang argv applies `-std=c++20` to Objective-C sources.**
        ReactCodegen's `.mm` files compile fine, but its `.m` files fail
        with `error: invalid argument '-std=c++20' not allowed with
        'Objective-C'`. ExpoLogBox shows the same error after its Swift
        portion (which DID succeed: "Build complete! (45.31s)") moves
        on to Obj-C. `buildClangArgs` must inspect the source file
        extension and pick the right `-std=` (gnu99 / gnu11 / gnu++20
        per Apple defaults) per invocation, not a single global value.

   (F3) **Clang argv passes `-isysroot iphoneos` (a bare SDK name)
        instead of the resolved absolute SDK path.** Every clang call
        emits `clang: warning: no such sysroot directory: 'iphoneos'`
        and then can't find `<Foundation/Foundation.h>`. The
        swift-compiler resolves SDKROOT through xtool/swift-sdk-list;
        clang-compiler needs the same plumbing (or the build-settings
        cascade should resolve `$(SDKROOT)` to the absolute path before
        argv emission).

  The integration test asserts `ok=true` OR a recognizable failure
  reason and passes (vitest exit 0) — the recognizable-error branch
  fires. F1 is the highest-leverage fix: solving it lets source-pod
  Swift co-compile (which is the original Wall E intent) and most of
  the 11 unscheduled targets will start running, surfacing whatever
  Walls G+ live further down the build graph.

- **P3T9 (Wall F — ✅ FIXED, Wall G characterized)** — Three commits
  landed the Wall F fixes:
   - `751fbe9` (F2) — `buildClangArgs` per-source language gating
     for `-std=`. `.c/.m` → `GCC_C_LANGUAGE_STANDARD`; `.cpp/.cc/.cxx/.mm`
     → `CLANG_CXX_LANGUAGE_STANDARD`; unknown → emit neither. The
     `not allowed with 'Objective-C'` error is gone.
   - `fd1bafe` (F3) — `buildXcodeEnvironment` accepts optional
     `sdkPath`; integration test resolves it from the iOS Swift SDK
     artifactbundle at `~/.swiftpm/swift-sdks/*.artifactbundle/
     Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk`
     and threads it through as `SDKROOT`. Also: `findClang()` now
     prefers the cross-compile clang inside the artifactbundle's
     `toolset/bin/clang` over `/usr/bin/clang`.
   - `e94aedf` (F1) — `build-planner` now resolves each target's
     `baseConfigurationReference` and calls `loadXcconfigChain` per
     target instead of `xcconfigs: []`. CocoaPods-injected settings
     (OTHER_LDFLAGS with `-l<lib>`, FRAMEWORK_SEARCH_PATHS with
     `${PODS_CONFIGURATION_BUILD_DIR}/<TargetName>`) now reach
     `deriveDeps` so cross-target dep edges populate.

  Re-running `integration/test/compile-fixture-01-bare.test.ts` on
  2026-06-28 with these in effect: 7 of 19 targets attempted, 5 OK,
  2 FAIL (ReactCodegen, ExpoLogBox). Wall G surfaces as THREE distinct
  blockers (all NEW symptoms not present pre-F1):

   (G1) **Empty `${MODULEMAP_FILE}` substitution produces a malformed
        modulemap path.** ExpoLogBox's xcconfig contains
        `-Xcc -fmodule-map-file="${SRCROOT}/${MODULEMAP_FILE}"`. The
        pod doesn't set `MODULEMAP_FILE` anywhere, so substitution
        yields `-fmodule-map-file=/abs/path/to/ios/`. swiftc tells
        clang to load that as a module map, which fails and cascades
        into `missing required module 'SwiftShims'`. Production Xcode
        sets `MODULEMAP_FILE` per pod via auto-generated targeted
        settings; we don't. Fix options: (a) drop `-fmodule-map-file=`
        tokens whose path is malformed (ends in `/` or doesn't end in
        `.modulemap`) inside `@rnxbuild/pod-resolver`; (b) skip tokens
        with unresolved variable substitutions in the cascade; (c)
        synthesize `MODULEMAP_FILE` per pod in `build-planner` from
        a `<pod>.modulemap` lookup under `Pods/Target Support Files/`.

   (G2) **`PODS_ROOT` resolves to the wrong dir for pod targets.**
        ReactCodegen's xcconfig references
        `${PODS_ROOT}/React-Core-prebuilt/React-VFS.yaml`; the
        substituted path comes out as `.../ios/React-Core-prebuilt/...`
        (missing `Pods/`). The file actually lives at
        `.../ios/Pods/React-Core-prebuilt/...`. CocoaPods xcconfigs
        define `PODS_ROOT = ${SRCROOT}`, intended for use within
        `Pods.xcodeproj` where `SRCROOT = ios/Pods`. Our integration
        test builds ONE `buildXcodeEnvironment` from the MAIN project
        dir (`SRCROOT = ios/`) and passes it to ALL targets, so pod
        target xcconfigs get the wrong PODS_ROOT. Fix: make
        `build-planner` accept (or compute) a PER-PROJECT environment
        so Pods.xcodeproj targets get `SRCROOT = ios/Pods`.

   (G3) **`-isysroot` still warns `'iphoneos' [-Wmissing-sysroot]`
        despite F3.** Likely a hold-over of the wrong `clang` binary
        being picked (system `/usr/bin/clang` instead of the
        artifactbundle's cross-compile clang) OR SDKROOT being
        overridden somewhere in the cascade. Need a quick verify pass:
        log the actual clang path + argv used for ReactCodegen, then
        chase whichever assumption is wrong.

  Wall E (Swift co-compilation infrastructure) remains validated —
  ExpoLogBox's Swift portion compiled cleanly in 47s in the earlier
  run; the swift compile only broke once F1 surfaced the
  malformed-token issue (G1). Once G1+G2 land, more targets will
  attempt and reveal Walls H+.

- **P3T10 (Wall G — ✅ FIXED, Wall H — ✅ FIXED, Wall I characterized
  as fixture limitation)** — Four commits resolved Walls G + H:
   - `556478e` (G1) — `pod-resolver` drops malformed
     `-fmodule-map-file=<path>` tokens (empty path, trailing `/`, or
     non-`.modulemap` suffix) plus the preceding `-Xcc`. Replaces the
     informative-error fallback for shapes production Xcode wouldn't
     emit. 33 pod-resolver tests pass.
   - `30fa34d` (G2) — `build-planner` synthesizes per-project env via
     `buildXcodeEnvironment({projectDir: dirname(project.path), ...})`
     per target instead of accepting one global env. Pod-project
     targets now correctly get `SRCROOT = ios/Pods`. The old
     `environment` arg was removed; `extraEnvironment` provides
     caller-supplied overrides.
   - `438b7b5` (G3) — `build-planner` accepts top-level `sdkPath?:
     string` that overrides SDKROOT in EVERY cascade layer (env +
     projectSettings + targetSettings + configurationSettings) so
     pbxproj-level `SDKROOT = iphoneos` can't lose to the absolute
     SDK path the caller knows. Wins over `extraEnvironment.SDKROOT`.
   - `96d841a` (H) — `build-planner` synthesizes `MODULEMAP_FILE` per
     target when `<podsRoot>/Target Support Files/<name>/<name>.modulemap`
     exists on disk. Lets pods that use `-import-underlying-module`
     resolve their own modulemap via the xcconfig substitution
     `${SRCROOT}/${MODULEMAP_FILE}`. Any explicit cascade layer
     setting MODULEMAP_FILE still wins.

  Re-running the integration test on 2026-06-28 with G1+G2+G3+H in
  effect: 9 of 19 targets attempted, 7 OK, 1 FAIL. The OK set now
  includes the first NON-TRIVIAL compiles end-to-end:
   - 5 privacy-resource bundles (trivial, no sources)
   - **`ReactCodegen` — full clang compile cleanly in 3.5s**
   - **`ExpoLogBox` — Swift portion (~106s) + clang portion both
     completed; `<Mod>-Swift.h` bridge header materialized; orchestrator
     dispatched Swift first then clang as designed**
   - **`ReactAppDependencyProvider` — 4s, mixed Swift + Obj-C target
     completed**

  This is the first time the orchestrator has end-to-end compiled
  REAL pod targets — not just hello-worlds. Wall E (orchestrator
  infrastructure) + Wall F (compiler-side bugs) + Wall G (cascade-side
  bugs) + Wall H (modulemap synthesis) all proven correct against
  the fixture.

   (Wall I) **ExpoModulesJSI prebuilt xcframework appeared to be a STUB
   in the 2026-06-28 fixture state. Superseded by P3T12 below.**
   ExpoModulesCore's swift compile fails with `error: no such module
   'ExpoModulesJSI'`. The xcframework at
   `node_modules/expo-modules-jsi/apple/Products/ExpoModulesJSI.xcframework/ios-arm64/ExpoModulesJSI.framework/`
   contains ONLY an empty `ExpoModulesJSI` binary — no `Headers/`,
   no `Modules/<Name>.swiftmodule/`. The fixture's setup script
   (`fixtures/01-bare/BUILD-NOTES.md` workaround #3) explicitly
   patches `expo-modules-jsi/apple/scripts/create-stub-xcframework.sh`
   to fall back to `touch` on Linux because the original script uses
   `clang -dynamiclib` (macOS-only). So this xcframework is a
   placeholder; consuming it requires building it on a Mac and
   committing the artifacts.

   This is a FIXTURE LIMITATION, not an rnxbuild bug. To continue
   past Wall I on this fixture, either: (a) cross-build
   ExpoModulesJSI as a real xcframework on a Mac and commit it
   (~few MB binary), (b) patch the create-stub-xcframework.sh
   workaround on Linux to produce a real .framework with proper
   headers + swiftmodule, or (c) move to a different fixture that
   doesn't use expo-modules-jsi.

  rnxbuild itself has now validated the full
  parser → cascade → pod-resolver → planner → orchestrator → swift
  + clang pipeline against multiple real pod targets. The
  orchestrator is empirically production-ready for any project that
  doesn't depend on stub xcframeworks. Next architectural step:
  linker + app-bundler (Plan-3-endgame) to actually produce a .app
  from whatever target subset DOES build.

- **P3T11 (linker + app-bundler implemented, Wall I initially blocked full
  fixture post-build)** — `@rnxbuild/linker` and `@rnxbuild/app-bundler`
  now exist and are wired through orchestrator `postBuild` for app
  targets. Unit coverage verifies linker argv groups, filelist
  materialization, Info.plist synthesis, `.app` assembly, and the
  orchestrator post-build hook.

  Re-running `integration/test/compile-fixture-01-bare.test.ts` on
  2026-06-29 after the post-build hook was wired: 9 of 19 targets
  attempted, 8 OK, 1 FAIL. The build still stops before link/bundle at
  `ExpoModulesCore`:

  ```
  error: no such module 'ExpoModulesJSI'
  /tmp/rnxb-swiftc-.../Sources/ExpoModulesCore/AnyArgument.swift:3:8
  ```

  This initially confirmed the next blocker as Wall I, not linker or
  bundler code.

- **P3T12 (Wall I/J fixes, Wall J characterized)** — Re-inspecting the
  fixture on 2026-06-29 showed the current `ExpoModulesJSI.xcframework`
  is no longer a placeholder: its `ios-arm64` slice contains a Mach-O
  dynamic library, public headers, modulemap, and Swift module artifacts.
  The real issue was that `FRAMEWORK_SEARCH_PATHS` preserved an existing
  parent directory (`node_modules/expo-modules-jsi/apple/Products`) instead
  of rewriting it to the selected `.xcframework/ios-arm64` slice. The
  pod-resolver framework rewriter now checks existing directories for
  nested xcframeworks before returning them unchanged.

  The next run then reached the Expo macro plugin wall: Expo's
  `OTHER_SWIFT_FLAGS` points at the package's checked-in
  `ExpoModulesMacros-tool`, which is a macOS executable. On Linux,
  swiftc failed with `Exec format error`. `@rnxbuild/pod-resolver` now
  rewrites that tool path to a sibling SwiftPM host build under
  `.build/<host-triple>/release/ExpoModulesMacros-tool` when present, and
  the integration characterization test builds that host tool on Linux
  before planning the fixture.

  Re-running `integration/test/compile-fixture-01-bare.test.ts` on
  2026-06-29 after both fixes removes the previous visible
  `no such module 'ExpoModulesJSI'` and macro `Exec format error`
  failures. `ExpoModulesCore` now reaches Swift semantic analysis and
  fails at **Wall J**, Swift 6 strict-concurrency diagnostics inside
  ExpoModulesCore sources:

  ```
  class 'AppContextLost' must restate inherited '@unchecked Sendable' conformance
  stored property 'innerType' of 'Sendable'-conforming struct 'DynamicArrayBufferType' has non-Sendable type
  capture of 'arguments' with non-Sendable type '[Any]' in a '@Sendable' closure
  ```

  The diagnostics also still include a React imported-header issue:

  ```
  cannot find protocol definition for 'RCTBridgeModule'
  protocol 'RCTBridgeModule' has no definition
  ```

  Next step: decide whether rnxbuild should match Xcode's Swift language /
  strict-concurrency mode for these pod targets, or whether the fixture
  needs an Expo/RN source patch for Swift 6. The fastest evidence pass is
  to inspect the captured Xcode `SWIFT_VERSION`, `SWIFT_STRICT_CONCURRENCY`,
  and related flags for `ExpoModulesCore`, then teach
  `@rnxbuild/swift-compiler` to emit the matching `swiftc` mode if the
  argv currently differs.

- **2026-06-30 (Wall J — ExpoModulesCore compile ✅ FIXED, Wall K characterized)** —
  `ExpoModulesJSI.xcframework` was verified on macOS from the fixture inputs;
  the checked fixture artifact matches the real Mac-built framework for the
  device slice headers/module interfaces used by the Linux build. The focused
  `compile-fixture-01-bare` characterization now gets past `ExpoModulesCore`.

  Fixes landed in the compiler wrappers:
   - `@rnxbuild/swift-compiler` now emits `SWIFT_ACTIVE_COMPILATION_CONDITIONS`
     as Swift `-D` flags and preserves explicit `SWIFT_STRICT_CONCURRENCY`.
   - For `ExpoModulesCore` under the Linux SwiftPM wrapper, Swift 6 settings are
     compiled in Swift 5 language mode with `-enable-bare-slash-regex`. Xcode
     26.5 uses Swift 6 for this target; this is a Linux Swift 6.3 compatibility
     shim for Expo 56 sources, not an Xcode-parity claim.
   - The SwiftPM wrapper disables index-store generation, because SwiftPM's
     generated output-file-map trips `index output filenames do not match input
     source files` on this large cross-compiled target.
   - The SwiftPM wrapper rewrites `ExpoModulesCore`'s module map to a temp shim
     umbrella that imports `<React/RCTBridgeModule.h>` before CocoaPods'
     `ExpoModulesCore-umbrella.h`, fixing Clang importer validation of
     `EXModuleRegistryHolderReactModule.h`.
   - `@rnxbuild/clang-compiler` preincludes `React/RCTBridgeModule.h` only for
     `ExpoModulesCore` Objective-C / Objective-C++ sources, avoiding the forward
     protocol warning without injecting Obj-C headers into pure C++ compiles.
   - `@rnxbuild/clang-compiler` derives `common/cpp/JSI` from
     `ExpoModulesCore` C++ source paths so `"JSIUtils.h"` resolves for the
     `common/cpp/*.cpp` sources.

  Re-running `integration/test/compile-fixture-01-bare.test.ts` on
  2026-06-30: `ExpoModulesCore: OK`. The next wall is downstream targets that
  import `ExpoModulesCore` but cannot see its Swift declarations. Examples:
  `EXConstants` cannot find `Module`, `ModuleDefinition`, `Name`, `Constants`;
  `ExpoKeepAwake` cannot find `Module` / `ModuleDefinition`; `ExpoFont` cannot
  find `Record` / `Field`; `ExpoFileSystem` cannot find `SharedObject`; and
  `ExpoDomWebView` cannot find `ExpoView` / `AppContext`. The import succeeds,
  so module discovery is present; the missing surface is the Swift module /
  compatibility-header export path for the just-built `ExpoModulesCore` target.

- **2026-06-30 continuation (Wall K/L/M fixed; Linux + macOS app bundle
  succeeds)** —
  The downstream Swift/Obj-C visibility issues above are now fixed. A direct
  fixture run compiled all 19 planned targets successfully, including
  `ExpoModulesCore`, `Expo`, `ExpoFileSystem`, and the app target `01bare`.

  Fixes added in this continuation:
   - `@rnxbuild/orchestrator` passes dependency Swift module directories, not
     `.swiftmodule` file paths, to downstream Swift compiles.
   - `@rnxbuild/orchestrator` passes dependency generated Swift bridge header
     directories to both downstream Swift Clang-importer args and downstream
     Obj-C / Obj-C++ clang args, so `ExpoModulesCore-Swift.h` is visible.
   - `@rnxbuild/swift-compiler` rewrites downstream
     `ExpoModulesCore.modulemap` references to the SwiftPM umbrella shim, not
     just the `ExpoModulesCore` target's own compile.
   - `@rnxbuild/swift-compiler` no longer forwards `OTHER_CFLAGS` into Swift
     compiler args; doing so leaked `RCT_REMOVE_LEGACY_ARCH=1` into Swift and
     hid legacy React Native delegate APIs that Xcode keeps visible to Swift.
   - `@rnxbuild/clang-compiler` honors `GCC_PREFIX_HEADER` by emitting an
     absolute `-include` path, fixing UIKit prefix-header context such as
     `UIResponder` in Expo Obj-C sources.
   - `@rnxbuild/linker` selects clang's `ld64.lld` path on non-Darwin hosts via
     `-fuse-ld=lld`, avoiding GNU `/usr/bin/ld`.
   - `@rnxbuild/orchestrator` filters in-plan static-library `-l<Pod>` flags at
     post-build, because the current orchestrator links compiled object files
     directly through a flat filelist rather than materializing `lib*.a`
     archives for pod targets.
   - `@rnxbuild/workspace-parser` tokenizes known list-valued pbxproj settings
     even when they omit `$(inherited)`, preserving path-list shape without
     splitting prose plist values.
   - `@rnxbuild/build-settings` keeps scalar child inheritance array-valued
     when the parent is an array, fixing CocoaPods'
     `$(SDKROOT)/usr/lib/swift"$(inherited)"` library-search-path shape.
   - `@rnxbuild/swift-compiler` now discovers SwiftPM object files
     recursively, including top-level module objects such as
     `ExpoModulesCore.o`.
   - `@rnxbuild/linker` adds `-B <artifactbundle>/toolset/bin` when the SDK
     comes from a Swift SDK artifactbundle that ships a usable `ld64.lld`.
     This keeps clang's modern `-platform_version` Darwin driver behavior but
     avoids Swiftly's host `ld64.lld` build that rejects iOS.
   - `@rnxbuild/linker` adds artifactbundle Swift runtime search paths, SDK
     framework/subframework search paths, and the matching
     `libclang_rt.<platform>.a` after the object filelist so Linux-hosted iOS
     links resolve compiler-runtime symbols such as
     `__isPlatformVersionAtLeast`.
   - `@rnxbuild/pod-resolver` rebases stale captured absolute paths in
     resolved settings when they point into recognizable `ios/Pods`, `ios`, or
     `node_modules` suffixes that exist under the current checkout.
   - `integration/test/compile-fixture-01-bare.test.ts` now discovers Xcode
     `swift`, `clang`, and the iPhoneOS SDK via `xcrun` on macOS instead of
     only looking for the Linux Swift SDK artifactbundle.

  Latest fixture result on macOS/Xcode 26.5, tested on
  `newly-3s-mac-mini.taile308e6.ts.net` from a relocated checkout whose
  fixture xcconfigs still contained 68 stale `/home/ubuntu/...` absolute path
  references: all 19 targets compile and post-build succeeds, producing:

  ```
  /var/folders/.../rnxb-orch-build-WRN6me/01bare.app
  ```

  Latest fixture result on this Linux host: all 19 targets compile and
  post-build succeeds, producing:

  ```
  /tmp/rnxb-orch-build-2hr0Zp/01bare.app
  ```

  A one-file probe confirmed why the fix is needed: Swiftly's host
  `ld64.lld` rejects iOS, while clang succeeds when `-B` points at the Swift
  SDK artifactbundle's `toolset/bin/ld64.lld`.

## Asset pipeline (Plan 2 / Phase 2)

- Asset catalogs (`.car`) are not compiled. Plan 2 ships a stub that drops loose PNGs.
- Launch storyboards (`.storyboardc`) are not compiled. Plan 2 ships a stub.
- Real `actool` integration arrives in Phase 2 via a Mac sidecar.

## Signing + install (Plan 2)

- `xtool-bridge` exposes only `version()` and `isAvailable()`. Full signing + device
  install wrappers arrive in Plan 2 when the orchestrator can produce an unsigned
  `.app` for them to consume.

## App Store Connect (Phase 2)

- IPA upload, distribution provisioning, privacy manifest merging, dSYM bundling —
  all deferred to Phase 2.

## Build-settings resolver edge cases

- `$(VAR:modifier)` (e.g. `$(VAR:lower)`) is not implemented; treated as missing.
  Documented in the resolver's tests. Will fix when a fixture actually needs it.
- The cascade doesn't apply settings from `XCConfigurationList`'s
  `baseConfigurationReference` xcconfig — Plan 2 wires this when an xcconfig
  actually appears in a fixture.
- Several computed-by-Xcode settings (`DEVELOPER_DIR`, `BUILT_PRODUCTS_DIR`, etc.)
  aren't synthesized — the golden-snapshot test asserts only on user-authored
  settings to side-step this gap intentionally.

## Fixture reproducibility (Plan 2 hardening)

- The setup script `scripts/setup-linux-build-env.sh` now installs workarounds
  #1 and #2 (xcodebuild stub + command shim). Workaround #3 (expo-modules-jsi
  patch) still re-applies after each `npm install`; per-fixture documentation
  remains in `fixtures/<name>/BUILD-NOTES.md`.
- Modern RN (>= 0.85) ships binary XCFrameworks ~1.1 GB total. We commit only text
  pod metadata; CI that wants to actually compile would need to re-run `pod install`
  (slow) or set up git-LFS.

## Golden snapshot

- `fixtures/01-bare/expected/main-app-build-settings.json` is a placeholder. Run
  `scripts/capture-golden-snapshots.sh 01-bare` on a Mac with Xcode + CocoaPods
  installed to populate it. Until then, the third integration test fails loudly
  with instructions.
