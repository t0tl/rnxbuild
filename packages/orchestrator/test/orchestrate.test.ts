import { describe, expect, it } from "vitest";
import { orchestrate } from "../src/orchestrate.js";
import type { BuildPlan, BuildPlanTarget } from "@rnxbuild/build-planner";
import type { BuildContext } from "@rnxbuild/build-settings";
import type { CompileResult as SwiftCompileResult, SwiftCompiler } from "@rnxbuild/swift-compiler";
import type { CompileResult as ClangCompileResult, ClangCompiler } from "@rnxbuild/clang-compiler";
import type { Linker } from "@rnxbuild/linker";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

function tgt(id: string, name: string, deps: string[] = [], opts?: Partial<BuildPlanTarget>): BuildPlanTarget {
  return {
    id, name,
    productModuleName: name,
    productType: "com.apple.product-type.library.static",
    sources: { swift: [`/s/${name}.swift`], objc: [], objcpp: [], c: [], cpp: [] },
    settings: {},
    deps,
    resources: [],
    ...opts,
  };
}

function swiftOk(overrides: Partial<SwiftCompileResult> = {}): SwiftCompileResult {
  return {
    ok: true, exitCode: 0, stdout: "", stderr: "",
    argv: [], objectFiles: [], buildDir: "",
    ...overrides,
  };
}

function clangOk(overrides: Partial<ClangCompileResult> = {}): ClangCompileResult {
  return {
    ok: true, exitCode: 0, stdout: "", stderr: "",
    argv: [], objectFiles: [],
    ...overrides,
  };
}

const noopClang: ClangCompiler = { compile: () => Promise.resolve(clangOk()) };

describe("orchestrate", () => {
  it("walks targets in topological order: tier 0 first then tier 1", async () => {
    const order: string[] = [];
    const plan: BuildPlan = {
      targets: [tgt("T_A", "A"), tgt("T_B", "B", ["T_A"])],
      context: CTX,
      podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const swift: SwiftCompiler = {
      compile: (i) => {
        order.push(`swift:${i.moduleName}`);
        return Promise.resolve(swiftOk());
      },
    };
    const result = await orchestrate(plan, {
      swiftPath: "/swift", clangPath: "/clang", buildRoot,
      _swiftCompiler: swift,
      _clangCompiler: noopClang,
    });
    expect(order).toEqual(["swift:A", "swift:B"]);
    expect(result.ok).toBe(true);
    expect(result.targets.size).toBe(2);
  });

  it("runs targets within a single tier in PARALLEL (both start before either finishes)", async () => {
    let pending = 0;
    let maxPending = 0;
    const plan: BuildPlan = {
      targets: [tgt("T_A", "A"), tgt("T_B", "B"), tgt("T_C", "C")],
      context: CTX, podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const swift: SwiftCompiler = {
      compile: async () => {
        pending++;
        if (pending > maxPending) maxPending = pending;
        await new Promise((r) => setTimeout(r, 10));
        pending--;
        return swiftOk();
      },
    };
    await orchestrate(plan, {
      swiftPath: "/swift", clangPath: "/clang", buildRoot,
      _swiftCompiler: swift,
      _clangCompiler: noopClang,
    });
    expect(maxPending).toBeGreaterThanOrEqual(2);
  });

  it("returns ok=false with failure info on first tier-failure; does NOT start later tiers", async () => {
    const startedNames: string[] = [];
    const plan: BuildPlan = {
      targets: [tgt("T_A", "A"), tgt("T_B", "B", ["T_A"])],
      context: CTX, podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const swift: SwiftCompiler = {
      compile: (i) => {
        startedNames.push(i.moduleName);
        if (i.moduleName === "A") {
          return Promise.resolve(swiftOk({ ok: false, exitCode: 1, stderr: "A boom" }));
        }
        return Promise.resolve(swiftOk());
      },
    };
    const result = await orchestrate(plan, {
      swiftPath: "/swift", clangPath: "/clang", buildRoot,
      _swiftCompiler: swift,
      _clangCompiler: noopClang,
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.targetName).toBe("A");
    expect(result.failure?.reason).toContain("A boom");
    expect(startedNames).not.toContain("B");
  });

  it("calls onTargetStart + onTargetComplete callbacks in order, per target", async () => {
    const events: string[] = [];
    const plan: BuildPlan = {
      targets: [tgt("T_A", "A"), tgt("T_B", "B", ["T_A"])],
      context: CTX, podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const swift: SwiftCompiler = { compile: () => Promise.resolve(swiftOk()) };
    await orchestrate(plan, {
      swiftPath: "/swift", clangPath: "/clang", buildRoot,
      onTargetStart: (t) => events.push(`start:${t.name}`),
      onTargetComplete: (t, r) => events.push(`complete:${t.name}:${r.ok}`),
      _swiftCompiler: swift,
      _clangCompiler: noopClang,
    });
    expect(events).toEqual([
      "start:A", "complete:A:true",
      "start:B", "complete:B:true",
    ]);
  });

  it("populates targets Map with every COMPLETED build (even after a sibling fails)", async () => {
    const plan: BuildPlan = {
      targets: [tgt("T_A", "A"), tgt("T_B", "B"), tgt("T_C", "C")],
      context: CTX, podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const swift: SwiftCompiler = {
      compile: (i) => {
        if (i.moduleName === "B") {
          return Promise.resolve(swiftOk({ ok: false, exitCode: 1, stderr: "B fail" }));
        }
        return Promise.resolve(swiftOk());
      },
    };
    const result = await orchestrate(plan, {
      swiftPath: "/swift", clangPath: "/clang", buildRoot,
      _swiftCompiler: swift,
      _clangCompiler: noopClang,
    });
    expect(result.ok).toBe(false);
    expect(result.targets.has("T_A")).toBe(true);
    expect(result.targets.has("T_C")).toBe(true);
    expect(result.targets.has("T_B")).toBe(true);
    expect(result.targets.get("T_B")!.ok).toBe(false);
  });

  it("sets totalDurationMs to a non-negative number", async () => {
    const plan: BuildPlan = {
      targets: [tgt("T_A", "A")],
      context: CTX, podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));
    const swift: SwiftCompiler = { compile: () => Promise.resolve(swiftOk()) };
    const result = await orchestrate(plan, {
      swiftPath: "/swift", clangPath: "/clang", buildRoot,
      _swiftCompiler: swift,
      _clangCompiler: noopClang,
    });
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("orchestrate post-build", () => {
  it("invokes linker + bundler when an app target exists and all compiles succeed", async () => {
    const plan: BuildPlan = {
      targets: [
        tgt("T_APP", "App", [], {
          productType: "com.apple.product-type.application",
          settings: { EXECUTABLE_NAME: "App", PRODUCT_BUNDLE_IDENTIFIER: "com.test", SDKROOT: "/sdk" },
        }),
      ],
      context: CTX,
      podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-postbuild-"));
    const linkerCalls: unknown[] = [];
    const linker: Linker = {
      link: async (input) => {
        linkerCalls.push(input);
        await writeFile(input.outputPath, "linked");
        return { ok: true, exitCode: 0, argv: [], outputPath: input.outputPath, stdout: "", stderr: "" };
      },
    };

    const result = await orchestrate(plan, {
      swiftPath: "/swift",
      clangPath: "/clang",
      buildRoot,
      _swiftCompiler: {
        compile: () =>
          Promise.resolve(
            swiftOk({
              objectFiles: ["/o/a.swift.o"],
              moduleFilePath: "/m/App.swiftmodule",
            }),
          ),
      },
      _clangCompiler: noopClang,
      _linker: linker,
    });

    expect(result.ok).toBe(true);
    expect(linkerCalls).toHaveLength(1);
    expect(result.app?.ok).toBe(true);
    expect(result.app?.appPath).toBe(join(buildRoot, "App.app"));
  });

  it("does not invoke postBuild when there is no app target", async () => {
    const plan: BuildPlan = {
      targets: [tgt("T_LIB", "Lib", [], { productType: "com.apple.product-type.library.static" })],
      context: CTX,
      podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-no-app-"));
    let linkerCalled = false;

    const result = await orchestrate(plan, {
      swiftPath: "/swift",
      clangPath: "/clang",
      buildRoot,
      _swiftCompiler: { compile: () => Promise.resolve(swiftOk()) },
      _clangCompiler: noopClang,
      _linker: {
        link: () => {
          linkerCalled = true;
          return Promise.resolve({ ok: true, exitCode: 0, argv: [], outputPath: "", stdout: "", stderr: "" });
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(linkerCalled).toBe(false);
    expect(result.app).toBeUndefined();
  });

  it("does not invoke postBuild when compile failed", async () => {
    const plan: BuildPlan = {
      targets: [
        tgt("T_APP", "App", [], {
          productType: "com.apple.product-type.application",
          settings: { SDKROOT: "/sdk" },
        }),
      ],
      context: CTX,
      podsRoot: "/p",
    };
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-fail-postbuild-"));
    let linkerCalled = false;

    const result = await orchestrate(plan, {
      swiftPath: "/swift",
      clangPath: "/clang",
      buildRoot,
      _swiftCompiler: {
        compile: () => Promise.resolve(swiftOk({ ok: false, exitCode: 1, stderr: "compile boom" })),
      },
      _clangCompiler: noopClang,
      _linker: {
        link: () => {
          linkerCalled = true;
          return Promise.resolve({ ok: true, exitCode: 0, argv: [], outputPath: "", stdout: "", stderr: "" });
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(linkerCalled).toBe(false);
    expect(result.app).toBeUndefined();
  });
});
