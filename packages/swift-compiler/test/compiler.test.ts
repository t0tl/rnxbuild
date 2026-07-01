import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSwiftCompiler } from "../src/compiler.js";

// Real source files on disk — the new compiler `cp()`s sources into a SwiftPM
// package layout, so the inputs must actually exist.
let fixtureDir: string;
let helloSwift: string;
let badSwift: string;
let modSwift: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "rnxb-swiftc-test-"));
  helloSwift = join(fixtureDir, "Hello.swift");
  badSwift = join(fixtureDir, "Bad.swift");
  modSwift = join(fixtureDir, "M.swift");
  await writeFile(helloSwift, "// hello\n");
  await writeFile(badSwift, "// bad\n");
  await writeFile(modSwift, "// m\n");
});

afterAll(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

describe("createSwiftCompiler", () => {
  it("invokes `swift build` with --swift-sdk and forwards remaining swiftc flags via -Xswiftc", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const compiler = createSwiftCompiler({ swiftPath: "/usr/local/bin/swift", run: runner });

    const result = await compiler.compile({
      settings: {
        SWIFT_VERSION: "5.0",
        IPHONEOS_DEPLOYMENT_TARGET: "17.0",
        OTHER_SWIFT_FLAGS: ["-DFOO"],
        HEADER_SEARCH_PATHS: ["/some/header/path"],
      },
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
      sources: [helloSwift],
      outputDir: "/tmp/out",
      moduleName: "Hello",
    });

    expect(result.ok).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
    const call = runner.mock.calls[0] as [string, string[], { cwd?: string }];
    const binary = call[0];
    const argv = call[1];
    const runOpts = call[2];

    expect(binary).toBe("/usr/local/bin/swift");
    expect(argv[0]).toBe("build");
    expect(argv).toContain("--swift-sdk");
    expect(argv).toContain("arm64-apple-ios");
    expect(argv).toContain("--disable-index-store");
    expect(argv).toContain("-c");
    expect(argv).toContain("debug");

    // Per-target swiftc flags must come through via -Xswiftc.
    expect(argv).toContain("-Xswiftc");
    expect(argv).toContain("-swift-version");
    expect(argv).toContain("-DFOO");

    // SwiftPM-controlled flags must NOT be forwarded (they'd duplicate / conflict).
    expect(argv).not.toContain("-target");
    expect(argv).not.toContain("-o");
    expect(argv).not.toContain("-emit-module");
    expect(argv).not.toContain("-emit-module-path");
    expect(argv).not.toContain("-module-name");
    // Source files must NOT be forwarded — SwiftPM discovers them from Sources/.
    expect(argv).not.toContain(helloSwift);

    // Builder ran in a temp dir.
    expect(runOpts?.cwd).toMatch(/rnxb-swiftc-/);
    expect(result.buildDir).toBe(runOpts?.cwd);
  });

  it("returns ok=false with stderr when the build exits non-zero", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "error: no such module 'Foo'",
      exitCode: 1,
    });
    const compiler = createSwiftCompiler({ swiftPath: "/usr/local/bin/swift", run: runner });
    const result = await compiler.compile({
      settings: {},
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
      sources: [badSwift],
      outputDir: "/tmp/out",
      moduleName: "Bad",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such module");
  });

  it("returns a CompileResult with the expected shape on success", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    const compiler = createSwiftCompiler({ swiftPath: "/usr/local/bin/swift", run: runner });

    const result = await compiler.compile({
      settings: {},
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Release" },
      sources: [modSwift],
      outputDir: "/tmp/out",
      moduleName: "Mod",
    });

    // Shape checks — values for objectFiles/moduleFilePath depend on real fs
    // outputs that the integration suite covers.
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(Array.isArray(result.objectFiles)).toBe(true);
    expect(result.objectFiles).toEqual([]); // mock runner produces no files
    expect(result.moduleFilePath).toBeUndefined(); // no actual file emitted
    expect(typeof result.buildDir).toBe("string");
    expect(result.buildDir.length).toBeGreaterThan(0);

    // Release config → -c release
    expect(result.argv).toContain("-c");
    expect(result.argv).toContain("release");
  });

  it("collects SwiftPM object files recursively, including top-level module objects", async () => {
    const runner = vi.fn().mockImplementation(
      async (_binary: string, _argv: string[], opts?: { cwd?: string }) => {
        const cwd = opts?.cwd;
        if (!cwd) throw new Error("expected cwd");
        const nestedDir = join(cwd, ".build", "arm64-apple-ios", "debug", "Mod.build");
        await mkdir(nestedDir, { recursive: true });
        await writeFile(join(nestedDir, "A.swift.o"), "");
        await writeFile(join(cwd, "Mod.o"), "");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    );
    const compiler = createSwiftCompiler({ swiftPath: "/usr/local/bin/swift", run: runner });

    const result = await compiler.compile({
      settings: {},
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
      sources: [modSwift],
      outputDir: "/tmp/out",
      moduleName: "Mod",
    });

    expect(result.objectFiles.some((path) => path.endsWith("/Mod.o"))).toBe(true);
    expect(result.objectFiles.some((path) => path.endsWith("/A.swift.o"))).toBe(true);
  });

  it("rewrites downstream ExpoModulesCore modulemap flags to a SwiftPM umbrella shim", async () => {
    const supportDir = join(fixtureDir, "Target Support Files", "ExpoModulesCore");
    await mkdir(supportDir, { recursive: true });
    const originalModulemap = join(supportDir, "ExpoModulesCore.modulemap");
    const originalUmbrella = join(supportDir, "ExpoModulesCore-umbrella.h");
    await writeFile(originalModulemap, "module ExpoModulesCore {}\n");
    await writeFile(originalUmbrella, "#import <ExpoModulesCore/ExpoModulesCore.h>\n");

    const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const compiler = createSwiftCompiler({ swiftPath: "/usr/local/bin/swift", run: runner });

    const result = await compiler.compile({
      settings: {
        PRODUCT_MODULE_NAME: "Expo",
        OTHER_SWIFT_FLAGS: [
          "-Xcc",
          `-fmodule-map-file=${originalModulemap}`,
          "-Xcc",
          `-fmodule-map-file=${originalModulemap}`,
        ],
      },
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
      sources: [modSwift],
      outputDir: "/tmp/out",
      moduleName: "Expo",
    });

    const rewrittenFlags = result.argv.filter((arg) =>
      arg.includes("ModuleMapShims/ExpoModulesCore/ExpoModulesCore.modulemap"),
    );
    expect(rewrittenFlags).toHaveLength(2);
    expect(result.argv).not.toContain(`-fmodule-map-file=${originalModulemap}`);

    const shimUmbrella = await readFile(
      join(result.buildDir, "ModuleMapShims", "ExpoModulesCore", "ExpoModulesCore-umbrella.h"),
      "utf8",
    );
    expect(shimUmbrella).toContain("#import <React/RCTBridgeModule.h>");
    expect(shimUmbrella).toContain('__has_include("ExpoModulesCore-Swift.h")');
    expect(shimUmbrella).toContain('#import "ExpoModulesCore-Swift.h"');
    expect(shimUmbrella).toContain(originalUmbrella);
  });
});
