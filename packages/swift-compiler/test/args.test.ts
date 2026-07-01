import { describe, expect, it } from "vitest";
import { buildSwiftcArgs, type SwiftcArgsInput } from "../src/args.js";

const base: SwiftcArgsInput = {
  settings: {},
  context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
  sources: ["/tmp/A.swift", "/tmp/B.swift"],
  outputDir: "/tmp/out",
  moduleName: "TestMod",
};

describe("buildSwiftcArgs — basic shape", () => {
  it("includes the source files as positional args", () => {
    const args = buildSwiftcArgs(base);
    expect(args).toContain("/tmp/A.swift");
    expect(args).toContain("/tmp/B.swift");
  });

  it("emits a -target derived from arch + IPHONEOS_DEPLOYMENT_TARGET", () => {
    const args = buildSwiftcArgs({ ...base, settings: { IPHONEOS_DEPLOYMENT_TARGET: "17.0" } });
    const targetIdx = args.indexOf("-target");
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    expect(args[targetIdx + 1]).toBe("arm64-apple-ios17.0");
  });

  it("falls back to a default deployment target when missing", () => {
    const args = buildSwiftcArgs(base);
    const targetIdx = args.indexOf("-target");
    expect(args[targetIdx + 1]).toMatch(/^arm64-apple-ios\d+\.\d+$/);
  });

  it("includes --swift-sdk arm64-apple-ios", () => {
    const args = buildSwiftcArgs(base);
    const idx = args.indexOf("--swift-sdk");
    expect(args[idx + 1]).toBe("arm64-apple-ios");
  });

  it("emits -module-name from input + -emit-module-path when DEFINES_MODULE=YES", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { DEFINES_MODULE: "YES", PRODUCT_MODULE_NAME: "TestMod" },
    });
    const modIdx = args.indexOf("-module-name");
    expect(args[modIdx + 1]).toBe("TestMod");
    expect(args).toContain("-emit-module");
  });

  it("does NOT emit -emit-module when DEFINES_MODULE=NO or missing", () => {
    expect(buildSwiftcArgs(base)).not.toContain("-emit-module");
  });
});

describe("buildSwiftcArgs — SWIFT_VERSION", () => {
  it("truncates 5.0 to -swift-version 5", () => {
    const args = buildSwiftcArgs({ ...base, settings: { SWIFT_VERSION: "5.0" } });
    const idx = args.indexOf("-swift-version");
    expect(args[idx + 1]).toBe("5");
  });

  it("preserves a bare major like 6", () => {
    const args = buildSwiftcArgs({ ...base, settings: { SWIFT_VERSION: "6" } });
    const idx = args.indexOf("-swift-version");
    expect(args[idx + 1]).toBe("6");
  });

  it("emits explicit SWIFT_STRICT_CONCURRENCY settings", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { SWIFT_VERSION: "6.0", SWIFT_STRICT_CONCURRENCY: "complete" },
    });
    expect(args).not.toContain("-strict-concurrency=minimal");
    expect(args).toContain("-strict-concurrency=complete");
  });

  it("compiles ExpoModulesCore with Swift 5 mode on the Linux SwiftPM path", () => {
    const args = buildSwiftcArgs({
      ...base,
      moduleName: "ExpoModulesCore",
      settings: { PRODUCT_MODULE_NAME: "ExpoModulesCore", SWIFT_VERSION: "6.0" },
    });
    const idx = args.indexOf("-swift-version");
    expect(args[idx + 1]).toBe("5");
    expect(args).toContain("-enable-bare-slash-regex");
  });

  it("omits -swift-version when SWIFT_VERSION is absent", () => {
    expect(buildSwiftcArgs(base)).not.toContain("-swift-version");
  });
});

describe("buildSwiftcArgs — framework + header search paths", () => {
  it("emits one -F per FRAMEWORK_SEARCH_PATHS entry, preserving order", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { FRAMEWORK_SEARCH_PATHS: ["/a", "/b"] },
    });
    const fs = args.filter((a, i) => args[i - 1] === "-F");
    expect(fs).toEqual(["/a", "/b"]);
  });

  it("treats a string-valued FRAMEWORK_SEARCH_PATHS as a single entry", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { FRAMEWORK_SEARCH_PATHS: "/single" },
    });
    expect(args.filter((a, i) => args[i - 1] === "-F")).toEqual(["/single"]);
  });

  it("emits HEADER_SEARCH_PATHS with -Xcc on BOTH the -I flag AND the path (one -Xcc per forwarded token)", () => {
    // CRITICAL: swiftc's -Xcc forwards ONLY the next arg. So `-Xcc -I /path`
    // forwards `-I` to clang and leaves `/path` as a swiftc positional input
    // (silently broken). The correct pattern is `-Xcc -I -Xcc /path` — one
    // -Xcc per token meant for clang. Plan-3 Wall B regression test.
    const args = buildSwiftcArgs({
      ...base,
      settings: { HEADER_SEARCH_PATHS: ["/inc1", "/inc2"] },
    });
    // The path must be preceded by -Xcc directly, and the -I before it ALSO by -Xcc.
    const headerPaths = args.filter(
      (a, i) =>
        args[i - 1] === "-Xcc" &&
        args[i - 2] === "-I" &&
        args[i - 3] === "-Xcc",
    );
    expect(headerPaths).toEqual(["/inc1", "/inc2"]);
  });

  it("does NOT emit a bare -I followed by a path for HEADER_SEARCH_PATHS (regression for Wall B)", () => {
    // Defensive: explicitly assert the BROKEN pattern is absent. If a future
    // refactor accidentally drops one -Xcc, this test catches it before the
    // characterization fixture does.
    const args = buildSwiftcArgs({
      ...base,
      settings: { HEADER_SEARCH_PATHS: ["/headers"] },
    });
    // SWIFT_INCLUDE_PATHS also uses -I but bare (without -Xcc). Make sure HEADER's
    // path is never directly after a bare -I.
    // Find all -I indices; for each, the next arg must NOT be /headers (it should
    // be -Xcc instead, then /headers comes after).
    const iIndices: number[] = [];
    args.forEach((a, i) => { if (a === "-I") iIndices.push(i); });
    for (const idx of iIndices) {
      // If the -I is at the SWIFT_INCLUDE_PATHS position, args[idx-1] is NOT -Xcc.
      // If the -I is at the HEADER_SEARCH_PATHS position, args[idx-1] IS -Xcc and
      // args[idx+1] MUST be -Xcc (then args[idx+2] is the path).
      if (args[idx - 1] === "-Xcc") {
        expect(args[idx + 1], `HEADER_SEARCH_PATHS -I at index ${idx} must be followed by -Xcc, got ${args[idx + 1]}`).toBe("-Xcc");
      }
    }
  });

  it("SWIFT_INCLUDE_PATHS stays bare -I <path> (not -Xcc wrapped) — guard against over-correcting Wall B", () => {
    // SWIFT_INCLUDE_PATHS is consumed by swiftc itself, not forwarded to clang.
    // The fix for Wall B (HEADER_SEARCH_PATHS) must NOT accidentally wrap
    // SWIFT_INCLUDE_PATHS too. This regression test guards against that.
    const args = buildSwiftcArgs({
      ...base,
      settings: { SWIFT_INCLUDE_PATHS: ["/swift/a", "/swift/b"] },
    });
    const swiftPaths = args.filter((a, i) => args[i - 1] === "-I" && args[i - 2] !== "-Xcc");
    expect(swiftPaths).toEqual(["/swift/a", "/swift/b"]);
  });

  it("emits SWIFT_INCLUDE_PATHS via plain -I (Swift module import path)", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { SWIFT_INCLUDE_PATHS: ["/swift/inc"] },
    });
    const idx = args.indexOf("-I");
    expect(args[idx + 1]).toBe("/swift/inc");
  });

  it("preincludes RCTBridgeModule.h for ExpoModulesCore Clang importer parity", () => {
    const args = buildSwiftcArgs({
      ...base,
      moduleName: "ExpoModulesCore",
      settings: { PRODUCT_MODULE_NAME: "ExpoModulesCore" },
    });
    const idx = args.indexOf("-include");
    expect(idx).toBeGreaterThan(0);
    expect(args[idx - 1]).toBe("-Xcc");
    expect(args[idx + 1]).toBe("-Xcc");
    expect(args[idx + 2]).toBe("React/RCTBridgeModule.h");
  });

  it("preincludes the React-Core-prebuilt bridge module header when available", () => {
    const args = buildSwiftcArgs({
      ...base,
      moduleName: "ExpoModulesCore",
      settings: {
        PRODUCT_MODULE_NAME: "ExpoModulesCore",
        HEADER_SEARCH_PATHS: ["/Pods/Headers/Public/React-Core-prebuilt"],
      },
    });
    const idx = args.indexOf("-include");
    expect(args[idx + 2]).toBe(
      "/Pods/Headers/Public/React-Core-prebuilt/React_Core/React/RCTBridgeModule.h",
    );
  });

});

describe("buildSwiftcArgs — preprocessor + flags passthrough", () => {
  it("emits GCC_PREPROCESSOR_DEFINITIONS as -Xcc -D<def> pairs in order", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { GCC_PREPROCESSOR_DEFINITIONS: ["DEBUG=1", "TARGET_OS_IPHONE"] },
    });
    const defs = args.filter((a, i) => args[i - 1] === "-Xcc" && a.startsWith("-D"));
    expect(defs).toEqual(["-DDEBUG=1", "-DTARGET_OS_IPHONE"]);
  });

  it("passes OTHER_SWIFT_FLAGS through verbatim, preserving order", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { OTHER_SWIFT_FLAGS: ["-DFOO", "-warn-concurrency"] },
    });
    const flagsStart = args.indexOf("-DFOO");
    expect(args[flagsStart + 1]).toBe("-warn-concurrency");
  });

  it("emits SWIFT_ACTIVE_COMPILATION_CONDITIONS as Swift -D flags", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { SWIFT_ACTIVE_COMPILATION_CONDITIONS: ["DEBUG", "COCOAPODS"] },
    });
    expect(args).toContain("-D");
    expect(args.filter((a, i) => args[i - 1] === "-D")).toEqual(["DEBUG", "COCOAPODS"]);
  });

  it("does not forward OTHER_CFLAGS into Swift compiler args", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { OTHER_CFLAGS: ["-DRCT_REMOVE_LEGACY_ARCH=1", "-Wno-error"] },
    });
    expect(args).not.toContain("-DRCT_REMOVE_LEGACY_ARCH=1");
    expect(args).not.toContain("-Wno-error");
  });

  it("emits -Xcc -fmodules when CLANG_ENABLE_MODULES=YES", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { CLANG_ENABLE_MODULES: "YES" },
    });
    const fmodulesIdx = args.indexOf("-fmodules");
    expect(fmodulesIdx).toBeGreaterThan(0);
    expect(args[fmodulesIdx - 1]).toBe("-Xcc");
  });

  it("omits -fmodules when CLANG_ENABLE_MODULES is missing or NO", () => {
    expect(buildSwiftcArgs(base)).not.toContain("-fmodules");
    expect(
      buildSwiftcArgs({ ...base, settings: { CLANG_ENABLE_MODULES: "NO" } }),
    ).not.toContain("-fmodules");
  });
});

describe("buildSwiftcArgs — optimization + compilation mode", () => {
  it("translates SWIFT_OPTIMIZATION_LEVEL", () => {
    expect(buildSwiftcArgs({ ...base, settings: { SWIFT_OPTIMIZATION_LEVEL: "-Onone" } })).toContain("-Onone");
    expect(buildSwiftcArgs({ ...base, settings: { SWIFT_OPTIMIZATION_LEVEL: "-O" } })).toContain("-O");
    expect(buildSwiftcArgs({ ...base, settings: { SWIFT_OPTIMIZATION_LEVEL: "-Osize" } })).toContain("-Osize");
  });

  it("emits -wmo when SWIFT_COMPILATION_MODE=wholemodule", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { SWIFT_COMPILATION_MODE: "wholemodule" },
    });
    expect(args).toContain("-wmo");
  });
});

describe("buildSwiftcArgs — output paths", () => {
  it("places -o <outputDir>/<moduleName>.o", () => {
    const args = buildSwiftcArgs(base);
    const idx = args.indexOf("-o");
    expect(args[idx + 1]).toBe("/tmp/out/TestMod.o");
  });

  it("places -emit-module-path when DEFINES_MODULE=YES", () => {
    const args = buildSwiftcArgs({
      ...base,
      settings: { DEFINES_MODULE: "YES", PRODUCT_MODULE_NAME: "TestMod" },
    });
    const idx = args.indexOf("-emit-module-path");
    expect(args[idx + 1]).toBe("/tmp/out/TestMod.swiftmodule");
  });

  it("PRODUCT_MODULE_NAME from settings wins over input.moduleName for naming", () => {
    const args = buildSwiftcArgs({
      ...base,
      moduleName: "InputName",
      settings: { DEFINES_MODULE: "YES", PRODUCT_MODULE_NAME: "SettingsName" },
    });
    const moduleNameIdx = args.indexOf("-module-name");
    expect(args[moduleNameIdx + 1]).toBe("SettingsName");
    const modulePathIdx = args.indexOf("-emit-module-path");
    expect(args[modulePathIdx + 1]).toBe("/tmp/out/SettingsName.swiftmodule");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("/tmp/out/SettingsName.o");
  });

  it("falls back to input.moduleName when PRODUCT_MODULE_NAME is absent", () => {
    const args = buildSwiftcArgs({ ...base, moduleName: "InputOnly" });
    const moduleNameIdx = args.indexOf("-module-name");
    expect(args[moduleNameIdx + 1]).toBe("InputOnly");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("/tmp/out/InputOnly.o");
  });
});
