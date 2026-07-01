import { buildClangArgs, type ClangArgsInput } from "./args.js";
import { basename } from "node:path";

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

export interface ClangCompilerOptions {
  /** Absolute path to the `clang` binary. */
  clangPath: string;
  /** Injectable for tests; defaults to a real execa-backed runner. */
  run?: CommandRunner;
}

export interface CompileResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Full argv passed to clang (concatenated across per-source invocations, for debugging). */
  argv: string[];
  /** Absolute paths to expected produced .o files (one per source). */
  objectFiles: string[];
}

export interface ClangCompiler {
  compile(input: ClangArgsInput): Promise<CompileResult>;
}

/**
 * Invoke clang once per source file. Aggregates stdout/stderr; reports the
 * first non-zero exit code as the overall exit code. Each per-source invocation
 * receives the full argv from `buildClangArgs` but limited to its own source
 * (we re-build argv per source to avoid clang's "multiple sources → multiple
 * outputs" ambiguity).
 */
export function createClangCompiler(opts: ClangCompilerOptions): ClangCompiler {
  const run: CommandRunner =
    opts.run ??
    (async (binary, args, runOpts) => {
      const { execa } = await import("execa");
      const r = await execa(binary, args, { reject: false, cwd: runOpts?.cwd });
      return { stdout: String(r.stdout), stderr: String(r.stderr), exitCode: r.exitCode ?? 0 };
    });

  return {
    async compile(input) {
      const aggregateStdout: string[] = [];
      const aggregateStderr: string[] = [];
      const aggregateArgv: string[] = [];
      const objectFiles: string[] = [];
      let firstFailExitCode = 0;

      for (const source of input.sources) {
        const perSourceArgs = buildClangArgs({ ...input, sources: [source] });
        aggregateArgv.push(...perSourceArgs);
        const r = await run(opts.clangPath, perSourceArgs);
        aggregateStdout.push(r.stdout);
        aggregateStderr.push(r.stderr);
        const baseNoExt = basename(source).replace(/\.[^.]+$/, "");
        objectFiles.push(`${input.outputDir}/${baseNoExt}.o`);
        if (r.exitCode !== 0 && firstFailExitCode === 0) {
          firstFailExitCode = r.exitCode;
        }
      }

      return {
        ok: firstFailExitCode === 0,
        exitCode: firstFailExitCode,
        stdout: aggregateStdout.join("\n"),
        stderr: aggregateStderr.join("\n"),
        argv: aggregateArgv,
        objectFiles,
      };
    },
  };
}
