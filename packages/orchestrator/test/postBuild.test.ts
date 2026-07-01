import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postBuild } from "../src/postBuild.js";
import type { BuildPlan, BuildPlanTarget } from "@rnxbuild/build-planner";
import type { BuildContext } from "@rnxbuild/build-settings";
import type { Linker } from "@rnxbuild/linker";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("postBuild", () => {
  it("returns null when the plan has no app target", async () => {
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-postbuild-none-"));
    const result = await postBuild({
      plan: { targets: [target("L", "Lib")], context: CTX, podsRoot: "/pods" },
      perTargetResults: new Map(),
      buildRoot,
      clangPath: "/clang",
      sdkPath: "/sdk",
    });
    expect(result).toBeNull();
  });

  it("links all object files and bundles the app", async () => {
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-postbuild-app-"));
    const calls: Parameters<Linker["link"]>[0][] = [];
    const linker: Linker = {
      link: async (input) => {
        calls.push(input);
        await writeFile(input.outputPath, "fake linked binary", "utf8");
        return { ok: true, exitCode: 0, argv: [], outputPath: input.outputPath, stdout: "", stderr: "" };
      },
    };

    const plan: BuildPlan = {
      targets: [
        target("P", "PodA", { productModuleName: "PodA" }),
        target("A", "App", {
          productType: "com.apple.product-type.application",
          productModuleName: "App",
          settings: {
            EXECUTABLE_NAME: "App",
            PRODUCT_BUNDLE_IDENTIFIER: "com.example.app",
            SDKROOT: "/settings/sdk",
            OTHER_LDFLAGS: [
              "-framework",
              "UIKit",
              "-weak_framework",
              "JavaScriptCore",
              "-lPodA",
              "-lz",
            ],
          },
          objectFiles: ["/o/app.o"],
        }),
      ],
      context: CTX,
      podsRoot: "/pods",
    };

    const results = new Map([
      ["P", buildResult(["/o/pod.o"], "/m/PodA.swiftmodule")],
      ["A", buildResult(["/o/app.o"])],
    ]);

    const result = await postBuild({
      plan,
      perTargetResults: results,
      buildRoot,
      clangPath: "/clang",
      sdkPath: "/explicit/sdk",
      _linker: linker,
    });

    expect(result?.ok).toBe(true);
    expect(result?.appPath).toBe(join(buildRoot, "App.app"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.objectFiles).toEqual(["/o/pod.o", "/o/app.o"]);
    expect(calls[0]!.sdkPath).toBe("/explicit/sdk");
    expect(calls[0]!.staticLibraries).toEqual([]);
    expect(calls[0]!.settings.OTHER_LDFLAGS).toEqual([
      "-framework",
      "UIKit",
      "-weak_framework",
      "JavaScriptCore",
      "-lz",
    ]);
    expect(calls[0]!.frameworks).toEqual(["UIKit"]);
    expect(calls[0]!.weakFrameworks).toEqual(["JavaScriptCore"]);
    expect(calls[0]!.swiftModulesToEmbed).toEqual(["/m/PodA.swiftmodule"]);
    expect(await readFile(join(buildRoot, "App.app", "App"), "utf8")).toBe("fake linked binary");
  });

  it("returns a failure when link fails", async () => {
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-postbuild-fail-"));
    const linker: Linker = {
      link: (input) => Promise.resolve({
        ok: false,
        exitCode: 1,
        argv: [],
        outputPath: input.outputPath,
        stdout: "",
        stderr: "undefined symbols",
      }),
    };

    const result = await postBuild({
      plan: {
        targets: [
          target("A", "App", {
            productType: "com.apple.product-type.application",
            settings: { SDKROOT: "/sdk" },
          }),
        ],
        context: CTX,
        podsRoot: "/pods",
      },
      perTargetResults: new Map([["A", buildResult(["/o/app.o"])]]),
      buildRoot,
      clangPath: "/clang",
      _linker: linker,
    });

    expect(result?.ok).toBe(false);
    expect(result?.failureReason).toContain("undefined symbols");
  });
});

function target(
  id: string,
  name: string,
  overrides: Partial<BuildPlanTarget> = {},
): BuildPlanTarget {
  return {
    id,
    name,
    productModuleName: overrides.productModuleName ?? name,
    productType: overrides.productType ?? "com.apple.product-type.library.static",
    sources: { swift: [], objc: [], objcpp: [], c: [], cpp: [] },
    settings: overrides.settings ?? {},
    deps: [],
    resources: [],
    ...overrides,
  };
}

function buildResult(objectFiles: string[], swiftModule?: string) {
  return { ok: true, objectFiles, swiftModule, durationMs: 0, stdout: "", stderr: "" };
}
