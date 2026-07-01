import { describe, expect, it } from "vitest";
import { buildOneTarget } from "../src/buildOne.js";
import type { BuildPlanTarget } from "@rnxbuild/build-planner";
import type { BuildContext } from "@rnxbuild/build-settings";
import type { CompileResult as SwiftCompileResult } from "@rnxbuild/swift-compiler";
import type { CompileResult as ClangCompileResult } from "@rnxbuild/clang-compiler";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

function makeTarget(opts: Partial<BuildPlanTarget> & { id: string; name: string }): BuildPlanTarget {
  return {
    id: opts.id,
    name: opts.name,
    productModuleName: opts.productModuleName ?? opts.name,
    productType: opts.productType ?? "com.apple.product-type.library.static",
    sources: opts.sources ?? { swift: [], objc: [], objcpp: [], c: [], cpp: [] },
    settings: opts.settings ?? {},
    deps: opts.deps ?? [],
    resources: [],
  };
}

function swiftOk(overrides: Partial<SwiftCompileResult> = {}): SwiftCompileResult {
  return {
    ok: true, exitCode: 0, stdout: "", stderr: "",
    argv: [], objectFiles: [], buildDir: "/tmp",
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

describe("buildOneTarget", () => {
  it("dispatches Swift-only target through swift-compiler only", async () => {
    const swiftCalls: unknown[] = [];
    const clangCalls: unknown[] = [];
    const target = makeTarget({
      id: "T_X",
      name: "X",
      sources: { swift: ["/s/a.swift"], objc: [], objcpp: [], c: [], cpp: [] },
    });
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const result = await buildOneTarget({
      target,
      context: CTX,
      buildRoot,
      depResults: new Map(),
      swiftCompiler: {
        compile: (input) => {
          swiftCalls.push(input);
          return Promise.resolve(swiftOk({ objectFiles: ["/o/a.swift.o"] }));
        },
      },
      clangCompiler: {
        compile: (input) => {
          clangCalls.push(input);
          return Promise.resolve(clangOk());
        },
      },
    });

    expect(swiftCalls).toHaveLength(1);
    expect(clangCalls).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.objectFiles).toEqual(["/o/a.swift.o"]);
  });

  it("dispatches Obj-C-only target through clang-compiler only", async () => {
    const swiftCalls: unknown[] = [];
    const clangCalls: unknown[] = [];
    const target = makeTarget({
      id: "T_Y",
      name: "Y",
      sources: { swift: [], objc: ["/s/a.m"], objcpp: [], c: [], cpp: [] },
    });
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const result = await buildOneTarget({
      target,
      context: CTX,
      buildRoot,
      depResults: new Map(),
      swiftCompiler: {
        compile: (input) => {
          swiftCalls.push(input);
          return Promise.resolve(swiftOk());
        },
      },
      clangCompiler: {
        compile: (input) => {
          clangCalls.push(input);
          return Promise.resolve(clangOk({ objectFiles: ["/o/a.o"] }));
        },
      },
    });

    expect(swiftCalls).toHaveLength(0);
    expect(clangCalls).toHaveLength(1);
    expect(result.objectFiles).toEqual(["/o/a.o"]);
  });

  it("dispatches mixed target Swift FIRST then Obj-C, with bridge header on Obj-C include path", async () => {
    const order: string[] = [];
    let observedExtraIncludes: string[] | undefined;
    const target = makeTarget({
      id: "T_M",
      name: "Mixed",
      sources: { swift: ["/s/x.swift"], objc: [], objcpp: ["/s/y.mm"], c: [], cpp: [] },
    });
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    await buildOneTarget({
      target,
      context: CTX,
      buildRoot,
      depResults: new Map([
        [
          "T_Dep",
          {
            ok: true,
            objectFiles: [],
            swiftModule: "/build/Dep/swiftmodule/Dep.swiftmodule",
            swiftBridgeHeader: "/build/Dep/headers/Dep-Swift.h",
            durationMs: 0,
            stdout: "",
            stderr: "",
          },
        ],
      ]),
      swiftCompiler: {
        compile: () => {
          order.push("swift");
          return Promise.resolve(
            swiftOk({
              objectFiles: ["/o/x.swift.o"],
              bridgeHeaderPath: `${buildRoot}/Mixed/headers/Mixed-Swift.h`,
            }),
          );
        },
      },
      clangCompiler: {
        compile: (input) => {
          order.push("clang");
          observedExtraIncludes = input.extraIncludes;
          return Promise.resolve(clangOk({ objectFiles: ["/o/y.o"] }));
        },
      },
    });

    expect(order).toEqual(["swift", "clang"]);
    expect(observedExtraIncludes).toEqual([`${buildRoot}/Mixed/headers`, "/build/Dep/headers"]);
  });

  it("threads dep swiftmodule paths into swift-compiler call as swiftModuleSearchPaths", async () => {
    let observedSearchPaths: string[] | undefined;
    let observedHeaderPaths: string[] | undefined;
    const target = makeTarget({
      id: "T_C",
      name: "C",
      deps: ["T_A", "T_B"],
      sources: { swift: ["/s/x.swift"], objc: [], objcpp: [], c: [], cpp: [] },
    });
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));

    const depResults = new Map([
      [
        "T_A",
        {
          ok: true,
          objectFiles: [],
          swiftModule: "/build/A/Modules/A.swiftmodule",
          swiftBridgeHeader: "/build/A/headers/A-Swift.h",
          durationMs: 0,
          stdout: "",
          stderr: "",
        },
      ],
      [
        "T_B",
        {
          ok: true,
          objectFiles: [],
          swiftModule: "/build/B/swiftmodule",
          swiftBridgeHeader: "/build/B/headers/B-Swift.h",
          durationMs: 0,
          stdout: "",
          stderr: "",
        },
      ],
    ]);

    await buildOneTarget({
      target,
      context: CTX,
      buildRoot,
      depResults,
      swiftCompiler: {
        compile: (input) => {
          observedSearchPaths = input.swiftModuleSearchPaths;
          observedHeaderPaths = input.extraHeaderSearchPaths;
          return Promise.resolve(swiftOk({ buildDir: "" }));
        },
      },
      clangCompiler: { compile: () => Promise.resolve(clangOk()) },
    });

    expect(observedSearchPaths).toEqual(["/build/A/Modules", "/build/B/swiftmodule"]);
    expect(observedHeaderPaths).toEqual(["/build/A/headers", "/build/B/headers"]);
  });

  it("returns ok=false (and skips Obj-C) when Swift compile fails", async () => {
    const target = makeTarget({
      id: "T_F",
      name: "F",
      sources: { swift: ["/s/x.swift"], objc: ["/s/y.m"], objcpp: [], c: [], cpp: [] },
    });
    const buildRoot = await mkdtemp(join(tmpdir(), "rnxb-orch-"));
    let clangInvoked = false;

    const result = await buildOneTarget({
      target,
      context: CTX,
      buildRoot,
      depResults: new Map(),
      swiftCompiler: {
        compile: () =>
          Promise.resolve(
            swiftOk({ ok: false, exitCode: 1, stderr: "swift boom", buildDir: "" }),
          ),
      },
      clangCompiler: {
        compile: () => {
          clangInvoked = true;
          return Promise.resolve(clangOk());
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("swift boom");
    expect(clangInvoked).toBe(false);
  });
});
