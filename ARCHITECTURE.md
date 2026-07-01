# rnxbuild architecture

The TL;DR design lives in the parent `natively-dev` repo at
`docs/superpowers/specs/2026-06-27-rnxbuild-design.md`. This file summarizes what's
actually shipped in this repo (Plan 1 of N).

## Repo layout

```
rnxbuild/
├── packages/
│   ├── logger/             # structured pino-based logger
│   ├── plist/              # XML + binary plist round-trip
│   ├── workspace-parser/   # .xcworkspace + .pbxproj + .xcconfig
│   ├── build-settings/     # cascade + $(VAR) + conditionals
│   ├── target-graph/       # topological dependency ordering
│   ├── xtool-bridge/       # subprocess wrapper for xtool
│   ├── swift-compiler/     # cross-compile Swift via `swift build --swift-sdk arm64-apple-ios`
│   ├── diagnostic/         # doctor command logic
│   └── cli/                # rnxbuild entrypoint (build / install / doctor)
├── fixtures/
│   └── 01-bare/            # fresh Expo project + text-only Pods snapshot
├── integration/            # cross-package E2E tests against fixtures
└── scripts/
    └── capture-golden-snapshots.sh   # Mac-only: capture xcodebuild golden output
```

## Why this exists

We're spiking whether a Linux-native build pipeline can replace the Mac/xcodebuild
half of building Expo apps. xtool already solves the Swift toolchain + signing +
install pieces; rnxbuild is the orchestration layer that does what xcodebuild does.

## Phase 1 plan layout

- **Plan 1 (complete):** Bootstrap + parsers + build-settings resolver + doctor command + fixture 01-bare integration test against a Mac-golden snapshot.
- **Plan 2 (complete):** Workspace-parser/build-settings widening (first-class array settings, recursive xcconfig include loader, source-file extraction, file-reference resolution) + `@rnxbuild/swift-compiler` package (buildSwiftcArgs + createSwiftCompiler driving `swift build --swift-sdk arm64-apple-ios` against synthesized SwiftPM packages) + characterization test that runs the full pipeline against fixture-01-bare's real Swift sources and locks in the next three walls (xcconfig variable substitution, multi-value tokenization, OTHER_SWIFT_FLAGS unwrapping).
- **Plan 3:** Address the three Plan-2-characterized walls (build-settings/xcconfig handling), then add `@rnxbuild/clang-compiler` (Obj-C/Obj-C++), `@rnxbuild/linker`, `@rnxbuild/app-bundler`, framework-search-path discovery against the fixture's prebuilt XCFrameworks → produce a `.app` directory for fixture 01-bare.
- **Plan 4:** asset-catalog stub + storyboard handling + `@rnxbuild/xtool-bridge` sign+install integration + `@rnxbuild/orchestrator` → first end-to-end `.app` for fixture 01-bare → signed → installed on a tethered iPhone (v0.1 milestone).
- **Gate review.**
- **Phase 2 (separate spec):** Asset catalog (Mac sidecar), privacy manifests, distribution provisioning, App Store Connect upload, fixtures 04 + 05 + 06.

## Design discipline (port-readiness toward Rust)

- Pure functional logic in `src/`; I/O behind interfaces.
- Subprocess calls injected (see `@rnxbuild/xtool-bridge`'s `CommandRunner` for the pattern).
- Library dependencies chosen for having Rust equivalents (`@bacons/xcode` ↔ `@xcodekit/xcode` is byte-identical).
- One responsibility per package.

## Per-package config recipe (discovered during Plan 1)

Each package needs FIVE config files, not just `package.json` + `tsconfig.json`. This is
because of how pnpm isolation + `tsc -b` composite + ESLint projectService interact:

1. `package.json` — declares explicit `devDependencies` for vitest, typescript, eslint,
   typescript-eslint, @eslint/js. Without these, the package can't run its own checks
   in a strict-isolation pnpm setup.
2. `tsconfig.json` — the build config (`include: ["src/**/*"]`, `rootDir: "src"`).
3. `tsconfig.test.json` — separate config for tooling that needs to type-check tests
   (`include: ["src/**/*", "test/**/*"]`, `noEmit: true`). ESLint's `projectService`
   uses this to type-check test files.
4. `vitest.config.ts` — per-package test discovery (`include: ["test/**/*.test.ts"]`).
   The root config's `packages/**/test/**/*.test.ts` glob doesn't match when vitest is
   invoked from a package's CWD via `pnpm --filter`.
5. `eslint.config.mjs` — extends the root config but adds an override block for test
   files pointing at `tsconfig.test.json`.

Also: the lint script must be `eslint 'src/**/*.ts' 'test/**/*.ts'` (not `eslint src test`)
to avoid linting tsc-emitted `.js`/`.d.ts` files (composite projects emit even with
`--noEmit`; the root `.gitignore` keeps them out of git but they exist on disk after
typecheck).

Packages with workspace `references` in `tsconfig.json` must use
`"typecheck": "tsc --noEmit -p tsconfig.json"` instead of `tsc -b --noEmit` — the latter
errors on composite + references + --noEmit combos.

## Library discoveries

- `@bacons/xcode` stable v1 is unpublished; we pin `1.0.0-alpha.33`. The `parse`
  function lives at the `/json` subpath: `import { parse } from "@bacons/xcode/json"`.
- The plain `pino` logger uses `process.stdout.isTTY` to decide pretty vs JSON; tests
  run with no TTY so they get JSON output (which they don't assert against, so fine).

## Plan-2 driver invocation note

`@rnxbuild/swift-compiler` invokes `swift build --swift-sdk arm64-apple-ios`
against a synthesized SwiftPM package, NOT `swift swiftc` or direct
`swiftc`. This is necessary because:

- **Swift 6.3.x treats `swift swiftc` as a plugin subcommand lookup**. Running
  `swift swiftc -emit-object ...` fails with `error: unknown or missing
  subcommand 'swift-swiftc'`.
- **Direct `swiftc` doesn't accept `--swift-sdk`** — that flag is SwiftPM-only.
  swiftc takes a literal `-sdk <path>` and would require us to reimplement
  SwiftPM's artifactbundle resolution.

The `swift build` route delegates SDK resolution + target derivation +
output management to SwiftPM, which already knows how to consume the
`xtool sdk install`'d artifactbundle. We forward per-target compiler flags
via `-Xswiftc` (filtered to drop SwiftPM-controlled ones: `--swift-sdk`,
`-target`, `-o`, `-emit-module-path`, `-module-name`, and source paths
SwiftPM auto-discovers under `Sources/`).

## Linux-on-iOS-toolchain known gotchas (discovered scaffolding fixture 01-bare)

These aren't bugs in rnxbuild — they're the cost of running `pod install` on Linux
against a modern Expo / RN project. Detailed in `fixtures/01-bare/BUILD-NOTES.md`:

- React Native >= 0.85 ships prebuilt XCFrameworks (~1.1 GB of binaries). We commit
  only text-based pod metadata; binaries are gitignored.
- `react-native` calls `xcodebuild -version`; we use a stub at `/usr/local/bin/xcodebuild`.
- Ruby's backtick to `command -v` needs `/usr/local/bin/command` shimmed (shell-builtin
  vs executable mismatch on Linux).
- `expo-modules-jsi/apple/scripts/create-stub-xcframework.sh` uses `clang -dynamiclib`
  (macOS-only); patched to fall back to `touch` on Linux.

A Plan-2 (or pre-Plan-2 hardening) task should bundle these workarounds into a
`scripts/setup-linux-build-env.sh` so they're reproducible from a fresh clone.
