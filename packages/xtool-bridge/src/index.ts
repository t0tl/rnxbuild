import { execa } from "execa";

export interface ProcessResult {
  stdout: string;
  exitCode: number;
}

export type CommandRunner = (binary: string, args: string[]) => Promise<ProcessResult>;

export interface XtoolBridgeOptions {
  binaryPath: string;
  /** Injectable for tests; defaults to a real execa-backed runner. */
  run?: CommandRunner;
}

export interface XtoolBridge {
  binaryPath: string;
  version(): Promise<string>;
  isAvailable(): Promise<boolean>;
}

const VERSION_RE = /xtool\s+([0-9]+(?:\.[0-9]+)+(?:[-+][\w.]+)?)/i;

export function createXtoolBridge(opts: XtoolBridgeOptions): XtoolBridge {
  const run: CommandRunner =
    opts.run ??
    (async (binary, args) => {
      const result = await execa(binary, args, { reject: false });
      return { stdout: String(result.stdout), exitCode: result.exitCode ?? 0 };
    });

  return {
    binaryPath: opts.binaryPath,
    async version() {
      const r = await run(opts.binaryPath, ["--version"]);
      const m = VERSION_RE.exec(r.stdout);
      if (!m) throw new Error(`Could not parse xtool version from: ${r.stdout.trim()}`);
      return m[1]!;
    },
    async isAvailable() {
      try {
        const r = await run(opts.binaryPath, ["--version"]);
        return r.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}
