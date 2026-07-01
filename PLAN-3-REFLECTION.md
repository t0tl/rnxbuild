# Plan 3 architecture reflection (2026-06-28)

Captured at the natural step-back point — six walls fixed, Swift-side pipeline
is empirically grounded, Wall E surfaces a new class of problem (clang +
multi-language module integration) that warrants thinking-before-coding rather
than another reflexive wall fix.

This document survives Plan 3. It's a pattern catalog and a forward look, not a
running log — the running log is `KNOWN-BROKEN.md`.

## Where we are

10 packages, ~1.7 kLoC across `packages/*/src/`, 166 unit tests + 8 integration
tests passing. Six walls fixed in this cycle: Plan-2 walls 1–3 (P3T1+P3T2 —
shell tokenization + Xcode-builtin environment seeding), Wall A (pbxproj
`$(inherited)` tokenization), Wall B (`-Xcc -I -Xcc` quadruple), Wall C
(`rewriteModulemapPaths`), Wall D (`rewriteFrameworkSearchPaths`). All in the
parser / cascade / pod-resolver pipeline; no architectural rewrites needed.

The end-to-end Swift compilation pipeline now runs:

```
parseProject → targetSourceFiles → loadXcconfigChain
  → buildXcodeEnvironment → resolveTargetSettings
    → rewriteModulemapPaths → rewriteFrameworkSearchPaths
      → createSwiftCompiler.compile (swift build --swift-sdk arm64-apple-ios)
```

For SwiftUI hello-worlds and the Plan-1 cross-compile fixtures, this produces
real arm64 Mach-O `.o` files. For fixture-01-bare (real Expo SDK 56 / RN 0.85
project) it loads 13 modulemaps and 3 prebuilt xcframeworks cleanly, completes
umbrella-header resolution, and trips on Wall E inside Swift semantic analysis.

## Patterns that emerged

Six fixes, all small, all with the same shape. The pattern is what makes the
next round of work cheap.

### 1. Settings-dict is the universal currency

Every Plan-3 fix takes the form `(SettingsDict, options) → SettingsDict`:

- `rewriteModulemapPaths(settings, {podsRoot})`
- `rewriteFrameworkSearchPaths(settings, {podsRoot, context})`
- `normalizeBuildSettings` (in workspace-parser — pbxproj `$(inherited)` split)
- `buildXcodeEnvironment(...)` (seeds the cascade input)

Fixes that operate on the settings dict are trivial to compose. Fixes that
operate on argv are not (argv is the END of the pipeline; rewriting it
requires re-deriving context). **Keep the surface area of argv-building
small. Push transformation work into the settings dict.**

### 2. Tokenization is explicit, not implicit

Three of the walls were tokenization problems:

- **P3T1** — xcconfig values arrive as `string | string[]` based on shell-aware
  tokenization, not as raw strings
- **Wall A** — pbxproj scalars conditionally split when they contain `$(inherited)`
  (multi-word strings like `INFOPLIST_KEY_NSHumanReadableCopyright` stay scalar)
- **Wall B** — `-Xcc` only forwards the next arg; HEADER_SEARCH_PATHS needs
  `-Xcc -I -Xcc <path>` quadruples to land at clang correctly

The repeated lesson: every shell-string-like value in the build system needs
an explicit tokenization model. "It's a string" loses information. When
introducing a new flag-passthrough, decide the tokenization at the entry
point, not at the consumer.

### 3. Build-time-vs-source-tree path duality

Walls C + D are the same shape: CocoaPods xcconfigs reference build-time paths
(`${PODS_CONFIGURATION_BUILD_DIR}/<X>`, `${PODS_XCFRAMEWORKS_BUILD_DIR}/<X>`).
In our synthetic env, those don't exist. The on-disk source-tree counterpart
at a CocoaPods-convention location does.

`@rnxbuild/pod-resolver` now houses both rewriters. We will likely need more
(swiftmodule paths, header search paths, bundle resources). The package's
shape — pure async rewriter, sibling per concern, informative-error fallback,
synthetic-tmpdir tests — is the template for all future pod-aware
normalizations.

### 4. Informative-error fallback

Both rewriters preserve the original entry when no plausible target exists.
The downstream error keeps an informative path; the user gets a real
diagnostic instead of `<empty>` or `<rewritten-to-garbage>`.

**Default to preserve, not default to mangle.** Downstream tools have better
diagnostics than we do.

### 5. Pure functional with injected I/O

Every package follows the same shape:

- Pure logic in `src/`, returning new immutable structures
- File-system access is narrow and explicit (`await fileExists`, `await readFile`)
- Subprocess access injected via `CommandRunner` (see `xtool-bridge` + `swift-compiler`)

Wall-fixing is fast because unit tests under `mkdtemp()` exercise the real
I/O paths without integration overhead.

### 6. Per-package recipe is mechanical

The 5-config-file pattern (codified in `ARCHITECTURE.md`) has paid off. Each
new package boilerplate is ~10 minutes of structured work, not a rabbit hole.
`@rnxbuild/pod-resolver` was extracted from `@rnxbuild/swift-compiler` in
P3T6 in one short session.

## What Wall E tells us we'll need

Wall E is the first non-cascade wall. It splits into THREE distinct problems:

**E.a — Clang nullability cascade.** The prebuilt React.framework umbrella
header pulls in hundreds of headers; some declare API without nullability
annotations. `emit-module` doesn't tolerate these warnings. Production Xcode
suppresses them via CocoaPods-injected flags (or a tolerated warning level
that swiftc-via-SwiftPM doesn't carry forward). Investigation, not
implementation — likely a `CLANG_WARN_*` settings tweak or a `-Xcc -Wno-...`
addition.

**E.b — Multi-language module integration.** `import ExpoModulesCore`
succeeds (modulemap loads, clang module synthesizes) but Swift can't see
types like `FontUtilsModule`. The prebuilt `.framework`'s Swift portion
(typically `<Framework>.framework/Modules/<Name>.swiftmodule/`) either isn't
shipped or isn't on swiftc's search path. Likely another pod-resolver
rewriter: surface `.framework/Modules/` as `-I <dir>`.

**E.c — Pure-Swift Pod sources need co-compilation.** Some Expo Swift sources
ship as `.swift` files inside `node_modules/<expo-pkg>/ios/`, NOT as a
prebuilt. They need to be co-compiled into the main target (the way Xcode
treats Pod Swift sources as additional inputs to the main target's swiftc
invocation).

E.a is a settings tweak. E.b is another pod-resolver rewriter. E.c is the
first wall that demands a structural change: source discovery across the
target boundary into Pods.

After Wall E, the remaining critical path is well-understood:

1. **Obj-C / Obj-C++ compilation** — fixture-01-bare's `AppDelegate.mm` is
   Obj-C++; the main target has zero Swift sources but a real
   AppDelegate. We've been compiling synthetic Swift-only hello-worlds; we've
   never compiled the actual app's main entrypoint.
2. **Linking** — combining swift .o + clang .o + prebuilt frameworks +
   system libraries into a Mach-O executable.
3. **App bundling** — `<PRODUCT_NAME>.app/` directory with Info.plist,
   Frameworks/, resources.
4. **Orchestration** — walking the target graph, dispatching per-target
   build, collecting outputs.

## Proposed Plan-3-proper packages

Given the patterns, the natural breakdown:

### `@rnxbuild/clang-compiler` (NEW)

Sibling to `swift-compiler` in shape:

```typescript
export function buildClangArgs(input: ClangArgsInput): string[];
export function createClangCompiler(opts: ClangCompilerOptions): ClangCompiler;
```

- Translates resolved Xcode build settings to a clang argv
- Drives `clang -target arm64-apple-ios17.0` (clang accepts `-target` directly
  — no SwiftPM wrapping needed)
- Settings consumed: `GCC_PREPROCESSOR_DEFINITIONS`, `HEADER_SEARCH_PATHS`
  (now direct `-I`, not `-Xcc -I -Xcc`), `FRAMEWORK_SEARCH_PATHS`,
  `OTHER_CFLAGS`, `CLANG_*`, `ARCHS`, `IPHONEOS_DEPLOYMENT_TARGET`,
  `CLANG_ENABLE_OBJC_ARC`, `GCC_C_LANGUAGE_STANDARD`
- Handles `.m` / `.mm` / `.c` / `.cpp` sources from PBX
- Output: per-source `.o` files

Same args-builder-plus-driver split as swift-compiler. Estimate ~120 LoC
total (args + driver) + ~30 tests.

### `@rnxbuild/pod-resolver` (EXISTING — extend)

Two more rewriters anticipated:

- `rewriteSwiftModuleSearchPaths` — surface prebuilt
  `<Framework>.framework/Modules/` as `-I <dir>` to swiftc. Resolves Wall E.b.
- `rewriteFrameworkHeaderSearchPaths` (maybe) — surface adjacent
  `Headers/Public/<Pod>/` when prebuilt headers cross-reference them.
  Driven by what Wall E.a investigation surfaces.

Both follow Wall C/D shape exactly. ~50 LoC each.

May also house a source-discovery helper for Wall E.c:
`collectPodSwiftSources(podsRoot, projectSettings) → string[]` that walks
the pbxproj-declared Pod target source-file references and surfaces `.swift`
files for co-compilation.

### `@rnxbuild/linker` (NEW)

Wraps clang for linking (it's the iOS toolchain's preferred ld frontend,
not `/usr/bin/ld` direct):

```typescript
export function buildLinkerArgs(input: LinkerArgsInput): string[];
export function createLinker(opts: LinkerOptions): Linker;
```

- Settings consumed: `OTHER_LDFLAGS`, `LD_RUNPATH_SEARCH_PATHS`,
  `FRAMEWORK_SEARCH_PATHS`, `LIBRARY_SEARCH_PATHS`,
  `GCC_LINK_WITH_DYNAMIC_LIBRARIES`
- Input: list of `.o` files (from swift-compiler + clang-compiler), framework
  dirs, library dirs, output binary path
- Output: linked Mach-O executable
- Subprocess via injected `CommandRunner`

Estimate ~100 LoC + ~20 tests.

### `@rnxbuild/app-bundler` (NEW)

Composes a `.app` directory from the linked binary + metadata:

```typescript
export async function bundleApp(input: BundleAppInput): Promise<string>;
```

- Settings consumed: `PRODUCT_NAME`, `PRODUCT_BUNDLE_IDENTIFIER`,
  `EXECUTABLE_NAME`, `INFOPLIST_FILE`, `INFOPLIST_KEY_*`,
  `IPHONEOS_DEPLOYMENT_TARGET`, all the deployment-target / device-family
  keys that go into Info.plist
- Builds `<PRODUCT_NAME>.app/` with: main binary, generated Info.plist,
  `Frameworks/` subdir (copied from `FRAMEWORK_SEARCH_PATHS` xcframework
  slices), `*.lproj/` localization dirs, asset files
- Existing `@rnxbuild/plist` is the dependency for Info.plist generation
- Eventually consumed by `xtool-bridge` for sign + install

Estimate ~150 LoC + ~30 tests.

### `@rnxbuild/orchestrator` (NEW)

Top-level per-target build driver:

```typescript
export async function buildTarget(input: BuildTargetInput): Promise<BuildResult>;
```

- Walks the target graph (uses `@rnxbuild/target-graph`) in topological order
- For each target:
  1. Load build-settings cascade (`@rnxbuild/build-settings`)
  2. Apply pod-resolver rewriters (`@rnxbuild/pod-resolver`)
  3. Partition sources by language; dispatch to
     `@rnxbuild/swift-compiler` + `@rnxbuild/clang-compiler` in parallel
  4. Collect `.o` files
  5. Call `@rnxbuild/linker`
  6. Call `@rnxbuild/app-bundler` (for application targets)
- Output: built `.app` (or `.framework` / `.a` for non-app targets)

This is the package that ties everything together. Estimate ~200 LoC + ~30
tests.

### Total Plan-3-proper estimate

~720 new LoC, ~140 new tests, 4 new packages, ~3-5 days of subagent-driven
work assuming the wall-cadence holds.

## Suggested rollout order

1. **Wall E.b** — probably one new `rewriteSwiftModuleSearchPaths` rewriter
   in pod-resolver. Cheap; closes the visibility loop for prebuilts.
2. **Wall E.a** — investigation pass. Likely a settings or argv tweak rather
   than a new package.
3. **Wall E.c** — `collectPodSwiftSources` + integration test wires Pod Swift
   sources into the main target's compile. May surface a Wall F.
4. **`@rnxbuild/clang-compiler`** — required for AppDelegate.mm. Largest new
   piece. Spec it via brainstorming + writing-plans before coding.
5. **`@rnxbuild/linker`** — combine outputs.
6. **`@rnxbuild/app-bundler`** — produce a `.app`.
7. **`@rnxbuild/orchestrator`** — wire steps 4–6 together; replace the
   per-step manual driving currently in the integration test.

The Plan-3 endgame is `rnxbuild build` producing a real `.app` for
fixture-01-bare on Linux. That's the v0.0.6 milestone candidate, after
which Plan-4 picks up signing / install / asset catalogs.

## Patterns to enforce going forward

1. **Every new compiler/linker/bundler package implements the same shape**:
   pure args builder (input → argv) + I/O wrapper (injected `CommandRunner`)
   + sibling tests using `execa`.
2. **All CocoaPods-aware path rewrites live in `@rnxbuild/pod-resolver`**;
   CocoaPods-agnostic settings transforms live in `@rnxbuild/build-settings`.
3. **Tokenization is explicit** — anywhere we accept a shell-string-like
   value, we use the tokenizer.
4. **Informative-error fallback** — when uncertain, preserve the input.
5. **Settings-dict is the universal currency** — push transformation work
   into the dict; keep argv-building small.
6. **One characterization test per fixture** — the canary that surfaces
   walls one at a time. `compile-fixture-01-bare.test.ts` is the model.
7. **No premature abstraction.** Two sibling rewriters justify a package
   (`pod-resolver`); one rewriter would have been a single file in
   `swift-compiler`. Extract on the second instance, not the first.

## Risks worth tracking

- **Wall E.a may need a header pre-pass** if `CLANG_WARN_*` tuning can't tame
  the nullability cascade. That would be a new architectural shape (an
  umbrella-header preprocessor). Hopefully it's just settings.
- **The Plan-3 endgame `.app` may not run** even after linking — runtime
  missing-symbol errors only surface at install time. Expect a Wall F class
  of problem there (e.g., missing slice for some arch, dyld can't find a
  required framework at the embedded rpath).
- **`swift-compiler` synthesizes a SwiftPM package** as a workaround for
  Swift 6.3.x's `swift swiftc` plugin behavior. If we ever switch to a direct
  driver (when 6.4 fixes it, or when we want incremental builds), the
  args.ts builder is the stable surface; compiler.ts is replaceable. Keep
  the boundary clean.
- **`@rnxbuild/xtool-bridge` has barely been exercised.** When app-bundler
  lands, xtool-bridge becomes the critical sign+install path. Gaps will
  surface there.
- **Subprocess injection is uniform across packages, but per-package
  `CommandRunner` types currently aren't shared.** A future
  `@rnxbuild/process` package may earn its place — but only after the third
  instance, not before.

## What we're explicitly NOT doing

- Not rewriting xcconfig parsing — it works.
- Not refactoring the cascade — it works.
- Not extracting "tokenization" into its own package — single use point in
  workspace-parser is fine.
- Not adding generic logging/telemetry beyond `@rnxbuild/logger`.
- Not building build caching — premature.
- Not building incremental builds — premature.
- Not porting to Rust yet — the spike has to clear v0.0.6 (a real `.app`
  built and runnable) before the port debate matters.
