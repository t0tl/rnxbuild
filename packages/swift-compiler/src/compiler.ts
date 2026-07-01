import { buildSwiftcArgs, type SwiftcArgsInput } from "./args.js";
import type { SettingsDict, SettingValue } from "@rnxbuild/build-settings";
import { mkdtemp, writeFile, mkdir, stat, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, basename } from "node:path";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (
  binary: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<ProcessResult>;

export interface SwiftCompilerOptions {
  /** Absolute path to the `swift` binary (we invoke `swift build ...`). */
  swiftPath: string;
  /** Injectable for tests; defaults to a real execa-backed runner. */
  run?: CommandRunner;
}

export interface CompileResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The full argv passed to swift (for debugging). */
  argv: string[];
  /** Absolute paths to produced .o files (zero or more). */
  objectFiles: string[];
  /** Absolute path to the produced .swiftmodule if SwiftPM emitted one. */
  moduleFilePath?: string;
  /** Absolute path to the generated `<Module>-Swift.h` (when emitObjCHeader was true). */
  bridgeHeaderPath?: string;
  /** The temp build dir (for debugging). Caller doesn't need to clean it up — the OS will. */
  buildDir: string;
}

export interface SwiftCompiler {
  compile(input: SwiftcArgsInput): Promise<CompileResult>;
}

// SwiftPM-controlled flags that take a value. We drop these *and* the following arg.
const SWIFTPM_PROVIDED_FLAGS = new Set([
  "--swift-sdk",
  "-target",
  "-o",
  "-emit-module-path",
  "-module-name",
]);

// SwiftPM-controlled toggles (no value).
const SWIFTPM_PROVIDED_TOGGLES = new Set(["-emit-module"]);

export function createSwiftCompiler(opts: SwiftCompilerOptions): SwiftCompiler {
  const run: CommandRunner =
    opts.run ??
    (async (binary, args, runOpts) => {
      const { execa } = await import("execa");
      const r = await execa(binary, args, { reject: false, cwd: runOpts?.cwd });
      return { stdout: String(r.stdout), stderr: String(r.stderr), exitCode: r.exitCode ?? 0 };
    });

  return {
    async compile(input) {
      // Mirror args.ts's module-name resolution: PRODUCT_MODULE_NAME wins, else input.moduleName.
      const moduleName = scalarSetting(input.settings, "PRODUCT_MODULE_NAME") ?? input.moduleName;
      // SwiftPM identifiers can't have hyphens / non-word chars cleanly.
      const safeName = moduleName.replace(/[^A-Za-z0-9_]/g, "_");

      const buildDir = await mkdtemp(join(tmpdir(), "rnxb-swiftc-"));

      // Synthesize Package.swift
      const deploymentTarget =
        scalarSetting(input.settings, "IPHONEOS_DEPLOYMENT_TARGET") ?? "17.0";
      const platformVersion = `.v${deploymentTarget.split(".")[0]}`; // .v17 from "17.0"
      const packageSwift = `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "${safeName}",
  platforms: [.iOS(${platformVersion})],
  products: [.library(name: "${safeName}", targets: ["${safeName}"])],
  targets: [.target(name: "${safeName}")]
)
`;
      await writeFile(join(buildDir, "Package.swift"), packageSwift, "utf8");

      // Copy sources into Sources/<safeName>/
      const srcDir = join(buildDir, "Sources", safeName);
      await mkdir(srcDir, { recursive: true });
      for (const sourcePath of input.sources) {
        await cp(sourcePath, join(srcDir, basename(sourcePath)));
      }

      // Build swiftc args, then filter for SwiftPM compatibility, then pass via -Xswiftc.
      const rawSwiftcArgs = buildSwiftcArgs(input);
      const xswiftcArgs = filterForSwiftPM(rawSwiftcArgs);
      await rewriteExpoModulesCoreModulemapsForSwiftPM(buildDir, xswiftcArgs);

      const configFlag = input.context.config === "Release" ? "release" : "debug";
      const argv: string[] = [
        "build",
        "--swift-sdk",
        "arm64-apple-ios",
        "--disable-index-store",
        "-c",
        configFlag,
      ];
      for (const f of xswiftcArgs) argv.push("-Xswiftc", f);

      const r = await run(opts.swiftPath, argv, { cwd: buildDir });

      const objectFiles = await collectObjectFiles(buildDir);

      // .swiftmodule (SwiftPM emits for library products automatically)
      let moduleFilePath: string | undefined;
      const modulePath = join(
        buildDir,
        ".build",
        "arm64-apple-ios",
        configFlag,
        "Modules",
        `${safeName}.swiftmodule`,
      );
      try {
        await stat(modulePath);
        moduleFilePath = modulePath;
      } catch {
        /* not produced */
      }

      // Generated <Module>-Swift.h (when input.emitObjCHeader was true)
      let bridgeHeaderPath: string | undefined;
      if (input.emitObjCHeader && input.objCHeaderOutputDir) {
        const candidate = `${input.objCHeaderOutputDir}/${moduleName}-Swift.h`;
        try {
          await stat(candidate);
          bridgeHeaderPath = candidate;
        } catch {
          /* not produced — likely a build failure */
        }
      }

      return {
        ok: r.exitCode === 0,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        argv,
        objectFiles,
        moduleFilePath,
        bridgeHeaderPath,
        buildDir,
      };
    },
  };
}

async function collectObjectFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".o")) {
        out.push(path);
      }
    }
  }

  await visit(root);
  return out.sort();
}

function scalarSetting(settings: SettingsDict, key: string): string | undefined {
  const v: SettingValue | undefined = settings[key];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(" ") : v;
}

/**
 * Drop args that SwiftPM provides on its own behalf when invoked via `swift build`.
 * - --swift-sdk arm64-apple-ios (we pass directly to `swift build`)
 * - -target ... (SwiftPM derives from platform constraint)
 * - -o <path> (SwiftPM controls output location)
 * - -emit-module / -emit-module-path <path> (SwiftPM emits modules for library
 *   products automatically; -Xswiftc-passing these conflicts)
 * - -module-name <name> (SwiftPM uses the Package.swift target name)
 * - source file paths (SwiftPM discovers from Sources/)
 * - output .o / .swiftmodule paths
 */
function filterForSwiftPM(rawArgs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (SWIFTPM_PROVIDED_FLAGS.has(arg)) {
      i++; // skip flag + its value
      continue;
    }
    if (SWIFTPM_PROVIDED_TOGGLES.has(arg)) continue;
    if (arg === "arm64-apple-ios") continue; // belt-and-suspenders for --swift-sdk's value
    if (arg.endsWith(".swift")) continue; // source files
    if (arg.endsWith(".o")) continue; // output paths SwiftPM controls
    if (arg.endsWith(".swiftmodule")) continue;
    out.push(arg);
  }
  return out;
}

async function rewriteExpoModulesCoreModulemapsForSwiftPM(
  buildDir: string,
  args: string[],
): Promise<void> {
  let shimModulemap: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (
      !arg.includes("-fmodule-map-file=") ||
      !arg.includes("Target Support Files/ExpoModulesCore/ExpoModulesCore.modulemap")
    ) {
      continue;
    }

    if (!shimModulemap) {
      const originalModulemap = arg.slice(arg.indexOf("=") + 1);
      const originalUmbrella = join(dirname(originalModulemap), "ExpoModulesCore-umbrella.h");
      const shimDir = join(buildDir, "ModuleMapShims", "ExpoModulesCore");
      await mkdir(shimDir, { recursive: true });

      const shimUmbrella = join(shimDir, "ExpoModulesCore-umbrella.h");
      await writeFile(
        shimUmbrella,
        `#import <React/RCTBridgeModule.h>\n#if __has_include("ExpoModulesCore-Swift.h")\n#import "ExpoModulesCore-Swift.h"\n#endif\n#import "${originalUmbrella}"\n`,
        "utf8",
      );

      shimModulemap = join(shimDir, "ExpoModulesCore.modulemap");
      await writeFile(
        shimModulemap,
        `module ExpoModulesCore {\n  umbrella header "ExpoModulesCore-umbrella.h"\n\n  export *\n  module * { export * }\n}\n`,
        "utf8",
      );
    }

    args[i] = `${arg.slice(0, arg.indexOf("=") + 1)}${shimModulemap}`;
  }
}
