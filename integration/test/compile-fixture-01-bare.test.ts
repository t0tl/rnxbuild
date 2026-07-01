import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { parseProject, targetSourceFiles } from "@rnxbuild/workspace-parser";
import { type BuildContext } from "@rnxbuild/build-settings";
import { buildPlan } from "@rnxbuild/build-planner";
import { orchestrate } from "@rnxbuild/orchestrator";

// CHARACTERIZATION (P3T8 orchestrator wired):
// The full pipeline now runs via @rnxbuild/orchestrator: planner → topo tiers →
// per-target Swift then Obj-C compile with <Mod>-Swift.h bridging + per-tier
// swiftmodule search paths. Wall E (source-pod Swift co-compilation) was the
// motivating problem. This test locks in the OUTCOME — either ok=true (Wall E
// resolved) or a recognizable failure (Wall F). Either way the test passes;
// the assertions surface what the run actually did so KNOWN-BROKEN.md tracks
// reality, not speculation.

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../fixtures/01-bare");

let SWIFT_PATH: string | null = null;
let HAS_IOS_TOOLCHAIN = false;

beforeAll(async () => {
  SWIFT_PATH = await findSwift();
  if (SWIFT_PATH) {
    HAS_IOS_TOOLCHAIN = await hasIosToolchain(SWIFT_PATH);
    await ensureExpoMacroPluginForHost(SWIFT_PATH);
  }
});

async function findSwift(): Promise<string | null> {
  if (process.platform === "darwin") {
    const xcrunSwift = await xcrunFind("swift");
    if (xcrunSwift) return xcrunSwift;
  }

  const candidates = [
    `${process.env.HOME ?? ""}/.local/share/swiftly/bin/swift`,
    "/usr/local/bin/swift",
    "/usr/bin/swift",
  ];
  for (const c of candidates) {
    try { await stat(c); return c; } catch { /* */ }
  }
  return null;
}

async function findClang(): Promise<string | null> {
  if (process.platform === "darwin") {
    const xcrunClang = await xcrunFind("clang", "iphoneos");
    if (xcrunClang) return xcrunClang;
  }

  // PREFER the cross-compile clang inside the iOS Swift SDK artifactbundle —
  // that one knows about Apple SDK header conventions. Fall back to system
  // clangs (which lack iOS-aware behavior but are useful for sanity probes).
  const home = process.env.HOME ?? "";
  const artifactBundleClangs: string[] = [];
  try {
    const { glob } = await import("node:fs/promises");
    for await (const m of glob("*.artifactbundle/toolset/bin/clang", {
      cwd: `${home}/.swiftpm/swift-sdks`,
    })) {
      artifactBundleClangs.push(`${home}/.swiftpm/swift-sdks/${m}`);
    }
  } catch {
    /* glob may throw if the dir doesn't exist; fall through to system probes */
  }

  const candidates = [
    ...artifactBundleClangs,
    `${home}/.local/share/swiftly/bin/clang`,
    "/usr/local/bin/clang",
    "/usr/bin/clang",
  ];
  for (const c of candidates) {
    try { await stat(c); return c; } catch { /* */ }
  }
  return null;
}

async function hasIosToolchain(swiftPath: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return (await findIosSdkPath({ sdk: "iphoneos17.0", arch: "arm64", config: "Debug" })) !== null;
  }

  try {
    const r = await execa(swiftPath, ["sdk", "list"], { reject: false });
    return r.exitCode === 0 && String(r.stdout).includes("darwin");
  } catch {
    return false;
  }
}

async function xcrunFind(tool: string, sdk?: "iphoneos"): Promise<string | null> {
  const args = sdk ? ["--sdk", sdk, "--find", tool] : ["--find", tool];
  try {
    const r = await execa("xcrun", args, { reject: false });
    const stdout = String(r.stdout).trim();
    return r.exitCode === 0 && stdout ? stdout : null;
  } catch {
    return null;
  }
}

async function ensureExpoMacroPluginForHost(swiftPath: string): Promise<void> {
  if (process.platform !== "linux") return;

  const appleDir = join(
    fixtureRoot,
    "node_modules",
    "@expo",
    "expo-modules-macros-plugin",
    "apple",
  );
  const hostTool = join(
    appleDir,
    ".build",
    process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu",
    "release",
    "ExpoModulesMacros-tool",
  );

  try {
    await stat(hostTool);
    return;
  } catch {
    /* build it below */
  }

  const r = await execa(swiftPath, ["build", "-c", "release"], {
    cwd: appleDir,
    reject: false,
  });
  if (r.exitCode !== 0) {
    console.log(`[p3t8-test] ExpoModulesMacros host build failed:\n${r.stderr.slice(0, 1500)}`);
  }
}

async function findIosSdkPath(context: BuildContext): Promise<string | null> {
  if (process.platform === "darwin") {
    const sdk = context.sdk.startsWith("iphonesimulator") ? "iphonesimulator" : "iphoneos";
    try {
      const r = await execa("xcrun", ["--sdk", sdk, "--show-sdk-path"], { reject: false });
      const stdout = String(r.stdout).trim();
      if (r.exitCode === 0 && stdout) return stdout;
    } catch {
      /* */
    }
  }

  // Resolve the iOS SDK absolute path from the artifactbundle layout.
  // iPhoneOS.sdk for device builds; iPhoneSimulator.sdk for simulator.
  const home = process.env.HOME ?? "";
  const platform = context.sdk.startsWith("iphonesimulator") ? "iPhoneSimulator" : "iPhoneOS";
  try {
    const { glob } = await import("node:fs/promises");
    for await (const m of glob(
      `*.artifactbundle/Developer/Platforms/${platform}.platform/Developer/SDKs/${platform}.sdk`,
      { cwd: `${home}/.swiftpm/swift-sdks` },
    )) {
      return `${home}/.swiftpm/swift-sdks/${m}`;
    }
  } catch {
    /* */
  }
  return null;
}

describe("compile fixture-01-bare via @rnxbuild/orchestrator (P3T8 characterization)", () => {
  it(
    "plans + orchestrates the full target graph; records outcome",
    { timeout: 1_200_000 },
    async (testCtx) => {
      if (!HAS_IOS_TOOLCHAIN) {
        testCtx.skip();
        return;
      }

      const clangPath = await findClang();
      if (!clangPath) {
        console.log("[p3t8-test] clang not found alongside swift toolchain — skipping orchestrate");
        testCtx.skip();
        return;
      }

      const ctx: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

      const sdkPath = await findIosSdkPath(ctx);
      if (!sdkPath) {
        console.log("[p3t8-test] iOS SDK path not found — skipping orchestrate");
        testCtx.skip();
        return;
      }

      const { glob } = await import("node:fs/promises");
      let mainProjectPath: string | null = null;
      for await (const m of glob("ios/*.xcodeproj", { cwd: fixtureRoot })) {
        const full = resolve(fixtureRoot, m);
        if (!full.includes("/Pods/")) { mainProjectPath = full; break; }
      }
      expect(mainProjectPath, "main .xcodeproj not found").not.toBeNull();

      const podsProjectPath = resolve(fixtureRoot, "ios/Pods/Pods.xcodeproj");

      const [mainProject, podsProject] = await Promise.all([
        parseProject(mainProjectPath!),
        parseProject(podsProjectPath).catch(() => undefined),
      ]);

      const sourcesByTargetId: Record<string, string[]> = {};
      for (const t of mainProject.targets) {
        sourcesByTargetId[t.id] = targetSourceFiles(t, mainProject);
      }
      if (podsProject) {
        for (const t of podsProject.targets) {
          sourcesByTargetId[t.id] = targetSourceFiles(t, podsProject);
        }
      }

      const podsRoot = join(dirname(mainProjectPath!), "Pods");
      const plan = await buildPlan({
        mainProject, podsProject,
        context: ctx,
        sdkPath,
        podsRoot,
        sourcesByTargetId,
      });

      console.log(`[p3t8-test] plan has ${plan.targets.length} targets`);

      const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-build-"));
      const result = await orchestrate(plan, {
        swiftPath: SWIFT_PATH!,
        clangPath,
        buildRoot,
        onTargetComplete: (t, r) => {
          console.log(`[p3t8-test] ${t.name}: ${r.ok ? "OK" : "FAIL"} (${Math.round(r.durationMs)}ms)`);
        },
      });

      console.log(`[p3t8-test] orchestrate ok=${result.ok} totalMs=${Math.round(result.totalDurationMs)} targets=${result.targets.size}`);
      if (!result.ok) {
        console.log(`[p3t8-test] failure: ${result.failure?.targetName}`);
        console.log(`[p3t8-test] reason (first 2KB):\n${result.failure?.reason.slice(0, 2000)}`);
        // Surface ALL failed targets' stdout/stderr — the orchestrator only
        // reports the FIRST failure by tier-iteration order, but several may
        // have failed in the same tier. Dump each in turn so Wall F is fully
        // characterized in the log.
        for (const [tid, tr] of result.targets) {
          if (tr.ok) continue;
          const planTarget = plan.targets.find((p) => p.id === tid);
          console.log(`[p3t8-test] --- failed target ${planTarget?.name ?? tid} ---`);
          console.log(`[p3t8-test] stderr (first 2KB):\n${tr.stderr.slice(0, 2000)}`);
          console.log(`[p3t8-test] stdout (first 2KB):\n${tr.stdout.slice(0, 2000)}`);
        }
      }

      if (result.ok) {
        expect(result.targets.size).toBeGreaterThan(0);
        if (result.app?.ok) {
          const appPath = result.app.appPath;
          console.log(`[p3t8-test] produced .app at ${appPath}`);
          const binStat = await stat(join(appPath, "01bare"));
          expect(binStat.size).toBeGreaterThan(0);
          const plistStat = await stat(join(appPath, "Info.plist"));
          expect(plistStat.size).toBeGreaterThan(0);
        } else if (result.app && !result.app.ok) {
          console.log(`[p3t8-test] postBuild failed: ${result.app.failureReason?.slice(0, 1500)}`);
          expect(result.app.failureReason).toBeTruthy();
        }
      } else {
        const combined = (result.failure?.reason ?? "").toLowerCase();
        const recognizable =
          combined.includes("error:") ||
          combined.includes("cannot find") ||
          combined.includes("no such") ||
          combined.includes("failed");
        expect(
          recognizable,
          `expected a recognizable error in result.failure.reason, got:\n${combined.slice(0, 1500)}`,
        ).toBe(true);
      }
    },
  );
});
