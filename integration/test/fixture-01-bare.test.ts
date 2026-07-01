import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseWorkspace, parseProject } from "@rnxbuild/workspace-parser";
import { resolveTargetSettings, type BuildContext } from "@rnxbuild/build-settings";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../fixtures/01-bare");

describe("fixture 01-bare", () => {
  it("workspace parses and lists the expected projects", async () => {
    const workspacePath = await findWorkspace();
    const ws = await parseWorkspace(workspacePath);
    const locations = ws.projects.map((p) => p.location).sort();
    expect(locations.some((l) => l.endsWith(".xcodeproj") && !l.startsWith("Pods/"))).toBe(true);
    expect(locations).toContain("Pods/Pods.xcodeproj");
  });

  it("main app project parses and has one PBXNativeTarget of product type application", async () => {
    const proj = await findMainProject();
    const parsed = await parseProject(proj);
    const app = parsed.targets.find((t) => t.productType === "com.apple.product-type.application");
    expect(app).toBeDefined();
    expect(app!.configurations.map((c) => c.name).sort()).toEqual(["Debug", "Release"]);
  });

  it("resolved Debug iphoneos arm64 settings match the golden snapshot", async (testCtx) => {
    const goldenPath = resolve(fixtureRoot, "expected/main-app-build-settings.json");
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Record<string, string>;

    if ("_GOLDEN_SNAPSHOT_NEEDED" in golden) {
      // Skip (not fail) when the placeholder is still in place. CI stays green
      // on Linux; the test activates once someone captures the snapshot on a
      // Mac via scripts/capture-golden-snapshots.sh.
      testCtx.skip();
    }

    const proj = await findMainProject();
    const parsed = await parseProject(proj);
    const app = parsed.targets.find(
      (t) => t.productType === "com.apple.product-type.application",
    )!;
    const debug = app.configurations.find((c) => c.name === "Debug")!;
    const projDebug = parsed.projectConfigurations.find((c) => c.name === "Debug");

    const ctx: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };
    const resolved = resolveTargetSettings({
      xcconfigs: [],
      projectSettings: projDebug?.buildSettings ?? {},
      targetSettings: {},
      configurationSettings: debug.buildSettings,
      context: ctx,
    });

    const keysWeAssertOn = [
      "PRODUCT_NAME",
      "PRODUCT_BUNDLE_IDENTIFIER",
      "IPHONEOS_DEPLOYMENT_TARGET",
      "SWIFT_VERSION",
      "ALWAYS_SEARCH_USER_PATHS",
    ];
    for (const key of keysWeAssertOn) {
      if (key in golden) {
        expect(resolved[key], `mismatch on ${key}`).toBe(golden[key]);
      }
    }
  });
});

async function findWorkspace(): Promise<string> {
  const matches: string[] = [];
  for await (const m of glob("ios/*.xcworkspace", { cwd: fixtureRoot })) {
    matches.push(resolve(fixtureRoot, m));
  }
  if (matches.length === 0) throw new Error("No .xcworkspace found under fixtures/01-bare/ios");
  return matches[0]!;
}

async function findMainProject(): Promise<string> {
  const matches: string[] = [];
  for await (const m of glob("ios/*.xcodeproj", { cwd: fixtureRoot })) {
    matches.push(resolve(fixtureRoot, m));
  }
  const main = matches.find((p) => !p.includes("/Pods/"));
  if (!main) throw new Error("No main .xcodeproj found under fixtures/01-bare/ios");
  return main;
}
