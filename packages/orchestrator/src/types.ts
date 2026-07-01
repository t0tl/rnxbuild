import type { BuildPlanTarget } from "@rnxbuild/build-planner";

export interface OrchestrateOptions {
  /** Absolute path to the `swift` binary. */
  swiftPath: string;
  /** Absolute path to the `clang` binary. */
  clangPath: string;
  /** Absolute path to the iOS SDK root; falls back to app target SDKROOT when omitted. */
  sdkPath?: string;
  /**
   * Caller-owned root. Orchestrator creates per-target subdirs
   * (`${buildRoot}/${target.name}/{swiftmodule,headers,obj}`) and overwrites
   * artifacts inside on each run. Caller decides when to clear it.
   */
  buildRoot: string;
  /** Optional progress callbacks (fired before / after each target build). */
  onTargetStart?: (target: BuildPlanTarget) => void;
  onTargetComplete?: (target: BuildPlanTarget, result: TargetBuildResult) => void;
}

export interface TargetBuildResult {
  ok: boolean;
  /** Per-source .o file paths from BOTH swift- and clang-compiler calls. */
  objectFiles: string[];
  /** Path to .swiftmodule (dir or file) when produced. */
  swiftModule?: string;
  /** Path to <Module>-Swift.h when produced. */
  swiftBridgeHeader?: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface BuildResult {
  ok: boolean;
  /** Per-target results. Includes successful builds even on overall failure. */
  targets: Map<string, TargetBuildResult>;
  /** Set when ok=false; the FIRST tier-failure that triggered cancellation. */
  failure?: { targetId: string; targetName: string; reason: string };
  /** Set when an application target was linked and bundled after compile. */
  app?: {
    /** Absolute path to the produced .app directory. */
    appPath: string;
    /** Whether linking and bundling both succeeded. */
    ok: boolean;
    /** Linker/bundler failure details when ok=false. */
    failureReason?: string;
  };
  totalDurationMs: number;
}

export class TargetBuildError extends Error {
  readonly target: BuildPlanTarget;
  readonly result: TargetBuildResult;
  constructor(target: BuildPlanTarget, result: TargetBuildResult, message: string) {
    super(message);
    this.name = "TargetBuildError";
    this.target = target;
    this.result = result;
  }
}
