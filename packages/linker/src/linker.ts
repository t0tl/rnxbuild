import { buildLinkerArgs, type LinkerArgsInput } from "./args.js";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export interface LinkerOptions {
  /** Absolute path to clang, matching the clang-compiler toolchain. */
  clangPath: string;
  /** On non-Darwin hosts, ask clang to route Darwin links through ld64.lld. */
  useLLD?: boolean;
  /** Optional linker search path passed to clang via `-B` when selecting lld. */
  darwinLinkerSearchPath?: string;
  /** Injectable for tests; defaults to a real execa-backed runner. */
  run?: CommandRunner;
}

export interface LinkResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Full argv passed to clang, for debugging. */
  argv: string[];
  /** Absolute path to the linked binary. */
  outputPath: string;
}

export interface Linker {
  link(input: LinkerArgsInput): Promise<LinkResult>;
}

export function createLinker(opts: LinkerOptions): Linker {
  const run: CommandRunner =
    opts.run ??
    (async (binary, args, runOpts) => {
      const { execa } = await import("execa");
      const r = await execa(binary, args, { reject: false, cwd: runOpts?.cwd });
      return { stdout: String(r.stdout), stderr: String(r.stderr), exitCode: r.exitCode ?? 0 };
    });

  return {
    async link(input) {
      const tmp = await mkdtemp(join(tmpdir(), "rnxb-linker-"));
      const filelistPath = join(tmp, "filelist.txt");
      await writeFile(filelistPath, input.objectFiles.map((p) => `${p}\n`).join(""), "utf8");

      const args = buildLinkerArgs(input);
      const artifactbundleArgs = await artifactbundleRuntimeArgs(input);
      if (opts.useLLD ?? process.platform !== "darwin") {
        const linkerSearchPath =
          opts.darwinLinkerSearchPath ?? await artifactbundleToolsetBin(input.sdkPath);
        if (linkerSearchPath) args.unshift("-B", linkerSearchPath);
        args.unshift("-fuse-ld=lld");
      }
      args.push(...artifactbundleArgs.searchArgs);
      args.push("-filelist", filelistPath);
      args.push(...artifactbundleArgs.postFilelistArgs);
      const result = await run(opts.clangPath, args);

      return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        argv: args,
        outputPath: input.outputPath,
      };
    },
  };
}

interface ArtifactbundleRuntimeArgs {
  searchArgs: string[];
  postFilelistArgs: string[];
}

async function artifactbundleToolsetBin(sdkPath: string): Promise<string | undefined> {
  const artifactbundleRoot = artifactbundleRootForSdk(sdkPath);
  if (!artifactbundleRoot) return undefined;
  const toolsetBin = join(artifactbundleRoot, "toolset", "bin");
  if (await pathExists(join(toolsetBin, "ld64.lld"))) return toolsetBin;
  return undefined;
}

async function artifactbundleRuntimeArgs(input: LinkerArgsInput): Promise<ArtifactbundleRuntimeArgs> {
  const artifactbundleRoot = artifactbundleRootForSdk(input.sdkPath);
  if (!artifactbundleRoot) return { searchArgs: [], postFilelistArgs: [] };

  const toolchainRoot = join(
    artifactbundleRoot,
    "Developer",
    "Toolchains",
    "XcodeDefault.xctoolchain",
  );
  const searchArgs: string[] = [];
  const postFilelistArgs: string[] = [];

  const swiftLibDir = join(toolchainRoot, "usr", "lib", "swift", swiftPlatformDir(input.context.sdk));
  if (await pathExists(swiftLibDir)) searchArgs.push("-L", swiftLibDir);

  const systemFrameworks = join(input.sdkPath, "System", "Library", "Frameworks");
  if (await pathExists(systemFrameworks)) searchArgs.push("-F", systemFrameworks);
  const systemSubFrameworks = join(input.sdkPath, "System", "Library", "SubFrameworks");
  if (await pathExists(systemSubFrameworks)) searchArgs.push("-F", systemSubFrameworks);

  const clangRuntime = await clangRuntimeLib(toolchainRoot, input.context.sdk);
  if (clangRuntime) postFilelistArgs.push(clangRuntime);

  return { searchArgs, postFilelistArgs };
}

function artifactbundleRootForSdk(sdkPath: string): string | undefined {
  const suffix = ".artifactbundle";
  const idx = sdkPath.indexOf(suffix);
  if (idx < 0) return undefined;
  return sdkPath.slice(0, idx + suffix.length);
}

async function clangRuntimeLib(
  toolchainRoot: string,
  sdk: string,
): Promise<string | undefined> {
  const clangRoot = join(toolchainRoot, "usr", "lib", "clang");
  let versions: string[];
  try {
    versions = (await readdir(clangRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return undefined;
  }

  const runtimeName = `libclang_rt.${clangPlatformName(sdk)}.a`;
  for (const version of versions) {
    const candidate = join(clangRoot, version, "lib", "darwin", runtimeName);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

function swiftPlatformDir(sdk: string): string {
  if (sdk.startsWith("iphonesimulator")) return "iphonesimulator";
  if (sdk.startsWith("appletvsimulator")) return "appletvsimulator";
  if (sdk.startsWith("appletvos")) return "appletvos";
  if (sdk.startsWith("watchsimulator")) return "watchsimulator";
  if (sdk.startsWith("watchos")) return "watchos";
  if (sdk.startsWith("xrsimulator")) return "xrsimulator";
  if (sdk.startsWith("xros")) return "xros";
  return "iphoneos";
}

function clangPlatformName(sdk: string): string {
  if (sdk.startsWith("iphonesimulator")) return "iossim";
  if (sdk.startsWith("appletvsimulator")) return "tvossim";
  if (sdk.startsWith("appletvos")) return "tvos";
  if (sdk.startsWith("watchsimulator")) return "watchossim";
  if (sdk.startsWith("watchos")) return "watchos";
  if (sdk.startsWith("xrsimulator")) return "xrossim";
  if (sdk.startsWith("xros")) return "xros";
  return "ios";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
