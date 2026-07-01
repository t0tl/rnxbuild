import { topologicalTiers } from "@rnxbuild/target-graph";
import type { BuildPlan, BuildPlanTarget } from "@rnxbuild/build-planner";
import { createSwiftCompiler, type SwiftCompiler } from "@rnxbuild/swift-compiler";
import { createClangCompiler, type ClangCompiler } from "@rnxbuild/clang-compiler";
import { buildOneTarget } from "./buildOne.js";
import { postBuild } from "./postBuild.js";
import type { OrchestrateOptions, BuildResult, TargetBuildResult } from "./types.js";

interface InternalOptions extends OrchestrateOptions {
  /** Injected swift-compiler (tests). When unset, constructed from swiftPath. */
  _swiftCompiler?: SwiftCompiler;
  /** Injected clang-compiler (tests). When unset, constructed from clangPath. */
  _clangCompiler?: ClangCompiler;
  /** Injected linker (tests). When unset, constructed from clangPath. */
  _linker?: Parameters<typeof postBuild>[0]["_linker"];
}

/**
 * Walks the plan's targets in topological tiers, building each tier in parallel
 * via Promise.all. Fail-fast on first tier-failure: in-flight siblings finish
 * naturally (no AbortController plumbing in MVP); subsequent tiers are not
 * started. Returns a structured BuildResult.
 */
export async function orchestrate(
  plan: BuildPlan,
  opts: OrchestrateOptions,
): Promise<BuildResult> {
  const internal = opts as InternalOptions;
  const start = process.hrtime.bigint();
  const swiftCompiler = internal._swiftCompiler ?? createSwiftCompiler({ swiftPath: opts.swiftPath });
  const clangCompiler = internal._clangCompiler ?? createClangCompiler({ clangPath: opts.clangPath });

  const tiers = topologicalTiers(plan.targets);
  const results = new Map<string, TargetBuildResult>();
  let failure: BuildResult["failure"];

  for (const tier of tiers) {
    if (failure) break;

    // Run the whole tier to completion before evaluating fail-fast — in-flight
    // siblings finish naturally (no AbortController), and every completed build
    // is recorded in `results` regardless of any peer's outcome.
    const perTarget = await Promise.all(
      tier.map(async (target: BuildPlanTarget) => {
        opts.onTargetStart?.(target);
        const depResults = new Map<string, TargetBuildResult>();
        for (const depId of target.deps) {
          const dr = results.get(depId);
          if (dr) depResults.set(depId, dr);
        }
        const r = await buildOneTarget({
          target,
          context: plan.context,
          buildRoot: opts.buildRoot,
          depResults,
          swiftCompiler,
          clangCompiler,
        });
        results.set(target.id, r);
        opts.onTargetComplete?.(target, r);
        return { target, result: r };
      }),
    );

    for (const { target, result } of perTarget) {
      if (!result.ok) {
        failure = {
          targetId: target.id,
          targetName: target.name,
          reason: summarizeFailure(target, result),
        };
        // Surface a TargetBuildError-shaped reason but keep going so the loop
        // can break cleanly on the next iteration. Only record the first.
        break;
      }
    }
  }

  const app = failure
    ? undefined
    : await postBuild({
        plan,
        perTargetResults: results,
        buildRoot: opts.buildRoot,
        clangPath: opts.clangPath,
        sdkPath: opts.sdkPath,
        _linker: internal._linker,
      });
  if (app && !app.ok) {
    failure = { targetId: "post-build", targetName: "post-build", reason: app.failureReason ?? "post-build failed" };
  }

  const totalDurationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return {
    ok: !failure,
    targets: results,
    failure,
    app: app ?? undefined,
    totalDurationMs,
  };
}

function summarizeFailure(target: BuildPlanTarget, r: TargetBuildResult): string {
  const snippet = r.stderr.slice(0, 2048);
  return `target ${target.name} (${target.id}) failed:\n${snippet}`;
}
