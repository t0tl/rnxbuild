import { describe, expect, it } from "vitest";
import { buildClangArgs } from "../src/args.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("buildClangArgs — core", () => {
  it("emits -target derived from arch + IPHONEOS_DEPLOYMENT_TARGET (with default fallback)", () => {
    const args = buildClangArgs({
      settings: { IPHONEOS_DEPLOYMENT_TARGET: "16.0" },
      context: CTX,
      sources: ["/src/a.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("-target");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("arm64-apple-ios16.0");
  });

  it("falls back to deployment target 17.0 when IPHONEOS_DEPLOYMENT_TARGET unset", () => {
    const args = buildClangArgs({
      settings: {},
      context: CTX,
      sources: ["/src/a.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("-target");
    expect(args[idx + 1]).toBe("arm64-apple-ios17.0");
  });

  it("emits -isysroot from settings.SDKROOT when present", () => {
    const args = buildClangArgs({
      settings: { SDKROOT: "/path/to/sdk" },
      context: CTX,
      sources: ["/src/a.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("-isysroot");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/path/to/sdk");
  });

  it("does NOT emit -isysroot when SDKROOT is unset (caller may supply via env)", () => {
    const args = buildClangArgs({
      settings: {},
      context: CTX,
      sources: ["/src/a.m"],
      outputDir: "/out",
    });
    expect(args).not.toContain("-isysroot");
  });

  it("emits -arch from context.arch", () => {
    const args = buildClangArgs({
      settings: {},
      context: CTX,
      sources: ["/src/a.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("-arch");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("arm64");
  });

  it("emits -c -o <outputDir>/<basename>.o <source> for each source", () => {
    const args = buildClangArgs({
      settings: {},
      context: CTX,
      sources: ["/src/a.m", "/src/b.mm"],
      outputDir: "/out",
    });
    expect(args).toContain("-c");
    const aIdx = args.indexOf("/src/a.m");
    const bIdx = args.indexOf("/src/b.mm");
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(-1);
    expect(args[aIdx - 2]).toBe("-o");
    expect(args[aIdx - 1]).toBe("/out/a.o");
    expect(args[bIdx - 2]).toBe("-o");
    expect(args[bIdx - 1]).toBe("/out/b.o");
  });
});

describe("buildClangArgs — search paths", () => {
  it("emits -I for each HEADER_SEARCH_PATHS entry (string OR array)", () => {
    const argsArr = buildClangArgs({
      settings: { HEADER_SEARCH_PATHS: ["/a", "/b"] },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    const aIdx = argsArr.indexOf("/a");
    expect(argsArr[aIdx - 1]).toBe("-I");
    const bIdx = argsArr.indexOf("/b");
    expect(argsArr[bIdx - 1]).toBe("-I");
  });

  it("emits -F for each FRAMEWORK_SEARCH_PATHS entry", () => {
    const args = buildClangArgs({
      settings: { FRAMEWORK_SEARCH_PATHS: ["/f1", "/f2"] },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    const i1 = args.indexOf("/f1");
    expect(args[i1 - 1]).toBe("-F");
    const i2 = args.indexOf("/f2");
    expect(args[i2 - 1]).toBe("-F");
  });

  it("emits -I for each extraIncludes entry (orchestrator-supplied)", () => {
    const args = buildClangArgs({
      settings: {},
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
      extraIncludes: ["/build/A/headers"],
    });
    const idx = args.indexOf("/build/A/headers");
    expect(args[idx - 1]).toBe("-I");
  });

  it("preincludes RCTBridgeModule.h for ExpoModulesCore Obj-C parity", () => {
    const args = buildClangArgs({
      settings: { PRODUCT_MODULE_NAME: "ExpoModulesCore" },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("-include");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("React/RCTBridgeModule.h");
  });

  it("keeps the ExpoModulesCore preinclude on the logical React header path", () => {
    const args = buildClangArgs({
      settings: {
        PRODUCT_MODULE_NAME: "ExpoModulesCore",
        HEADER_SEARCH_PATHS: ["/Pods/Headers/Public/React-Core-prebuilt"],
      },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("-include");
    expect(args[idx + 1]).toBe("React/RCTBridgeModule.h");
  });

  it("does not preinclude Obj-C React headers for ExpoModulesCore C++ sources", () => {
    const args = buildClangArgs({
      settings: { PRODUCT_MODULE_NAME: "ExpoModulesCore" },
      context: CTX,
      sources: ["/src/x.cpp"],
      outputDir: "/out",
    });
    expect(args).not.toContain("-include");
  });

  it("adds ExpoModulesCore common/cpp/JSI as a C++ header search path", () => {
    const args = buildClangArgs({
      settings: { PRODUCT_MODULE_NAME: "ExpoModulesCore" },
      context: CTX,
      sources: ["/fixture/node_modules/expo-modules-core/common/cpp/EventEmitter.cpp"],
      outputDir: "/out",
    });
    const idx = args.indexOf("/fixture/node_modules/expo-modules-core/common/cpp/JSI");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-I");
  });

  it("emits GCC_PREFIX_HEADER as an absolute -include path relative to PROJECT_DIR", () => {
    const args = buildClangArgs({
      settings: {
        GCC_PREFIX_HEADER: "Target Support Files/Expo/Expo-prefix.pch",
        PROJECT_DIR: "/fixture/ios/Pods",
      },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("/fixture/ios/Pods/Target Support Files/Expo/Expo-prefix.pch");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-include");
  });

  it("emits absolute GCC_PREFIX_HEADER paths unchanged", () => {
    const args = buildClangArgs({
      settings: { GCC_PREFIX_HEADER: "/fixture/Expo-prefix.pch", PROJECT_DIR: "/other" },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    const idx = args.indexOf("/fixture/Expo-prefix.pch");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-include");
  });
});

describe("buildClangArgs — preprocessor + passthrough", () => {
  it("emits -D for each GCC_PREPROCESSOR_DEFINITIONS entry", () => {
    const args = buildClangArgs({
      settings: { GCC_PREPROCESSOR_DEFINITIONS: ["FOO=1", "BAR"] },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    expect(args).toContain("-DFOO=1");
    expect(args).toContain("-DBAR");
  });

  it("passes through OTHER_CFLAGS verbatim", () => {
    const args = buildClangArgs({
      settings: { OTHER_CFLAGS: ["-Wno-foo", "-fbar"] },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    expect(args).toContain("-Wno-foo");
    expect(args).toContain("-fbar");
  });

  it("passes through OTHER_CPLUSPLUSFLAGS verbatim", () => {
    const args = buildClangArgs({
      settings: { OTHER_CPLUSPLUSFLAGS: ["-Wno-cpp-thing"] },
      context: CTX,
      sources: ["/src/x.cpp"],
      outputDir: "/out",
    });
    expect(args).toContain("-Wno-cpp-thing");
  });
});

describe("buildClangArgs — feature toggles", () => {
  it("emits -fobjc-arc when CLANG_ENABLE_OBJC_ARC=YES", () => {
    const args = buildClangArgs({
      settings: { CLANG_ENABLE_OBJC_ARC: "YES" },
      context: CTX,
      sources: ["/src/x.m"],
      outputDir: "/out",
    });
    expect(args).toContain("-fobjc-arc");
  });

  it("does NOT emit -fobjc-arc when CLANG_ENABLE_OBJC_ARC=NO or unset", () => {
    expect(
      buildClangArgs({ settings: { CLANG_ENABLE_OBJC_ARC: "NO" }, context: CTX, sources: ["/x.m"], outputDir: "/o" }),
    ).not.toContain("-fobjc-arc");
    expect(
      buildClangArgs({ settings: {}, context: CTX, sources: ["/x.m"], outputDir: "/o" }),
    ).not.toContain("-fobjc-arc");
  });

  it("emits -fmodules when CLANG_ENABLE_MODULES=YES", () => {
    const args = buildClangArgs({
      settings: { CLANG_ENABLE_MODULES: "YES" },
      context: CTX,
      sources: ["/x.m"],
      outputDir: "/o",
    });
    expect(args).toContain("-fmodules");
  });

  it("emits -std=<C standard> from GCC_C_LANGUAGE_STANDARD", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17" },
      context: CTX,
      sources: ["/x.c"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=gnu17");
  });

  it("emits -std=<C++ standard> from CLANG_CXX_LANGUAGE_STANDARD", () => {
    const args = buildClangArgs({
      settings: { CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x.cpp"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=c++20");
  });

  it("emits optimization level from GCC_OPTIMIZATION_LEVEL", () => {
    const args = buildClangArgs({
      settings: { GCC_OPTIMIZATION_LEVEL: "s" },
      context: CTX,
      sources: ["/x.m"],
      outputDir: "/o",
    });
    expect(args).toContain("-Os");
  });

  it("does NOT emit optimization flag when GCC_OPTIMIZATION_LEVEL is unset", () => {
    const args = buildClangArgs({
      settings: {},
      context: CTX,
      sources: ["/x.m"],
      outputDir: "/o",
    });
    expect(args.some((a) => /^-O./.test(a))).toBe(false);
  });
});

describe("buildClangArgs — per-source language gating for -std=", () => {
  it("emits ONLY -std=<C> for a single .c source", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17", CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x/a.c"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=gnu17");
    expect(args).not.toContain("-std=c++20");
  });

  it("emits ONLY -std=<C> for a single .m (Obj-C) source", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17", CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x/a.m"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=gnu17");
    expect(args).not.toContain("-std=c++20");
  });

  it("emits ONLY -std=<C++> for a single .cpp source", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17", CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x/a.cpp"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=c++20");
    expect(args).not.toContain("-std=gnu17");
  });

  it("emits ONLY -std=<C++> for a single .mm (Obj-C++) source", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17", CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x/a.mm"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=c++20");
    expect(args).not.toContain("-std=gnu17");
  });

  it("emits ONLY -std=<C++> for a single .cc source", () => {
    const args = buildClangArgs({
      settings: { CLANG_CXX_LANGUAGE_STANDARD: "c++17" },
      context: CTX,
      sources: ["/x/a.cc"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=c++17");
  });

  it("emits ONLY -std=<C++> for a single .cxx source", () => {
    const args = buildClangArgs({
      settings: { CLANG_CXX_LANGUAGE_STANDARD: "c++17" },
      context: CTX,
      sources: ["/x/a.cxx"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=c++17");
  });

  it("emits NEITHER -std= for an unrecognized extension", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17", CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x/a.unknownext"],
      outputDir: "/o",
    });
    expect(args.some((a) => a.startsWith("-std="))).toBe(false);
  });

  it("emits BOTH -std= when multi-source with mixed languages (degenerate; driver normally splits per-source)", () => {
    const args = buildClangArgs({
      settings: { GCC_C_LANGUAGE_STANDARD: "gnu17", CLANG_CXX_LANGUAGE_STANDARD: "c++20" },
      context: CTX,
      sources: ["/x/a.m", "/x/b.cpp"],
      outputDir: "/o",
    });
    expect(args).toContain("-std=gnu17");
    expect(args).toContain("-std=c++20");
  });
});

describe("buildClangArgs — purity", () => {
  it("does not mutate input.settings", () => {
    const input = {
      settings: { HEADER_SEARCH_PATHS: ["/a"], OTHER_CFLAGS: ["-Wno-x"] },
      context: CTX,
      sources: ["/x.m"],
      outputDir: "/o",
    };
    buildClangArgs(input);
    expect(input.settings.HEADER_SEARCH_PATHS).toEqual(["/a"]);
    expect(input.settings.OTHER_CFLAGS).toEqual(["-Wno-x"]);
  });
});
