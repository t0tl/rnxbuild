import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseProject, targetSourceFiles } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectPath = resolve(here, "fixtures/HelloApp.xcodeproj");

describe("targetSourceFiles", () => {
  it("returns absolute paths to .m/.swift files in PBXSourcesBuildPhase", async () => {
    const proj = await parseProject(projectPath);
    const target = proj.targets.find((t) => t.name === "HelloApp")!;
    const sources = targetSourceFiles(target, proj);
    // The HelloApp fixture pbxproj has a single PBXBuildFile referencing AppDelegate.m
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/AppDelegate\.m$/);
    expect(sources[0]!.startsWith("/")).toBe(true);
  });

  it("returns empty array when target has no Sources build phase", async () => {
    const proj = await parseProject(projectPath);
    // Synthesize a target with no buildPhases
    const fakeTarget = {
      name: "Empty",
      productType: "com.apple.product-type.application",
      configurations: [],
      buildPhaseIds: [],
    };
    expect(targetSourceFiles(fakeTarget, proj)).toEqual([]);
  });
});

describe("resolveFileReferencePath", () => {
  it("returns null for an undefined reference id", async () => {
    const proj = await parseProject(projectPath);
    const { resolveFileReferencePath } = await import("../src/index.js");
    expect(resolveFileReferencePath(undefined, proj)).toBeNull();
  });

  it("resolves a known PBXFileReference id to an absolute path", async () => {
    const proj = await parseProject(projectPath);
    const { resolveFileReferencePath } = await import("../src/index.js");
    // Find the AppDelegate.m PBXFileReference id from the fixture
    const refId = Object.keys(proj.objects).find((id) => {
      const o = proj.objects[id]!;
      return o.isa === "PBXFileReference" && typeof o.path === "string" && o.path.endsWith("AppDelegate.m");
    })!;
    const resolved = resolveFileReferencePath(refId, proj);
    expect(resolved).toMatch(/AppDelegate\.m$/);
    expect(resolved!.startsWith("/")).toBe(true);
  });
});
