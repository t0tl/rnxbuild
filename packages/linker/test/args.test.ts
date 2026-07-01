import { describe, expect, it } from "vitest";
import { buildLinkerArgs } from "../src/args.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };
const SDK_PATH = "/Applications/Xcode.app/.../iPhoneOS.sdk";

describe("buildLinkerArgs - core", () => {
  it("emits -Xlinker -reproducible always", () => {
    const args = buildLinkerArgs(baseInput());
    const idx = args.indexOf("-reproducible");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-Xlinker");
  });

  it("emits -target from arch + IPHONEOS_DEPLOYMENT_TARGET with fallback", () => {
    const args = buildLinkerArgs(baseInput({ settings: { IPHONEOS_DEPLOYMENT_TARGET: "16.4" } }));
    const idx = args.indexOf("-target");
    expect(args[idx + 1]).toBe("arm64-apple-ios16.4");
  });

  it("falls back to deployment target 17.0", () => {
    const args = buildLinkerArgs(baseInput());
    const idx = args.indexOf("-target");
    expect(args[idx + 1]).toBe("arm64-apple-ios17.0");
  });

  it("emits -isysroot from input.sdkPath", () => {
    const args = buildLinkerArgs(baseInput({ sdkPath: "/abs/iPhoneOS.sdk" }));
    const idx = args.indexOf("-isysroot");
    expect(args[idx + 1]).toBe("/abs/iPhoneOS.sdk");
  });

  it("emits -O0 when GCC_OPTIMIZATION_LEVEL is unset", () => {
    expect(buildLinkerArgs(baseInput())).toContain("-O0");
  });

  it("emits optimization level from GCC_OPTIMIZATION_LEVEL", () => {
    expect(buildLinkerArgs(baseInput({ settings: { GCC_OPTIMIZATION_LEVEL: "3" } }))).toContain("-O3");
  });

  it("emits -o <outputPath>", () => {
    const args = buildLinkerArgs(baseInput({ outputPath: "/out/App" }));
    const idx = args.indexOf("-o");
    expect(args[idx + 1]).toBe("/out/App");
  });

  it("does not emit -dynamiclib for application productType", () => {
    expect(buildLinkerArgs(baseInput())).not.toContain("-dynamiclib");
  });

  it("emits -dynamiclib + -install_name for framework productType", () => {
    const args = buildLinkerArgs(
      baseInput({
        productType: "com.apple.product-type.framework",
        productModuleName: "MyFw",
        outputPath: "/out/MyFw.framework/MyFw",
      }),
    );
    expect(args).toContain("-dynamiclib");
    const idx = args.indexOf("-install_name");
    expect(args[idx + 1]).toBe("@rpath/MyFw.framework/MyFw");
  });

  it("emits -dynamiclib + -install_name for dylib productType", () => {
    const args = buildLinkerArgs(
      baseInput({
        productType: "com.apple.product-type.library.dynamic",
        productModuleName: "MyLib",
        outputPath: "/out/MyLib.dylib",
      }),
    );
    expect(args).toContain("-dynamiclib");
    const idx = args.indexOf("-install_name");
    expect(args[idx + 1]).toBe("@rpath/MyLib.dylib");
  });
});

describe("buildLinkerArgs - search paths", () => {
  it("emits -L for each LIBRARY_SEARCH_PATHS entry", () => {
    const args = buildLinkerArgs(baseInput({ settings: { LIBRARY_SEARCH_PATHS: ["/lib1", "/lib2"] } }));
    expect(args[args.indexOf("/lib1") - 1]).toBe("-L");
    expect(args[args.indexOf("/lib2") - 1]).toBe("-L");
  });

  it("emits -F for each FRAMEWORK_SEARCH_PATHS entry", () => {
    const args = buildLinkerArgs(
      baseInput({ settings: { FRAMEWORK_SEARCH_PATHS: ["/f1", "/f2"] } }),
    );
    expect(args[args.indexOf("/f1") - 1]).toBe("-F");
    expect(args[args.indexOf("/f2") - 1]).toBe("-F");
  });

  it("emits the implicit swift stdlib -L path derived from sdkPath", () => {
    const sdkPath =
      "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.5.sdk";
    expect(buildLinkerArgs(baseInput({ sdkPath }))).toContain(`${sdkPath}/usr/lib/swift`);
  });
});

describe("buildLinkerArgs - rpaths", () => {
  it("emits canonical executable rpaths", () => {
    const joined = buildLinkerArgs(baseInput()).join(" ");
    expect(joined).toContain("-rpath -Xlinker @executable_path");
    expect(joined).toContain("-rpath -Xlinker /usr/lib/swift");
    expect(joined).toContain("-rpath -Xlinker @executable_path/Frameworks");
    expect(joined).toContain("-rpath -Xlinker @loader_path/Frameworks");
  });

  it("emits LD_RUNPATH_SEARCH_PATHS settings entries as extra rpaths", () => {
    const joined = buildLinkerArgs(
      baseInput({ settings: { LD_RUNPATH_SEARCH_PATHS: ["@custom/path", "@another"] } }),
    ).join(" ");
    expect(joined).toContain("-rpath -Xlinker @custom/path");
    expect(joined).toContain("-rpath -Xlinker @another");
  });
});

describe("buildLinkerArgs - link flags", () => {
  it("emits -l<name> for each staticLibraries entry", () => {
    const args = buildLinkerArgs(baseInput({ staticLibraries: ["EXConstants", "ExpoLogBox"] }));
    expect(args).toContain("-lEXConstants");
    expect(args).toContain("-lExpoLogBox");
  });

  it("emits -framework <Name> for each frameworks entry", () => {
    const args = buildLinkerArgs(baseInput({ frameworks: ["UIKit", "Foundation"] }));
    expect(args[args.indexOf("UIKit") - 1]).toBe("-framework");
    expect(args[args.indexOf("Foundation") - 1]).toBe("-framework");
  });

  it("emits -weak_framework <Name> for each weakFrameworks entry", () => {
    const args = buildLinkerArgs(baseInput({ weakFrameworks: ["UserNotifications"] }));
    expect(args[args.indexOf("UserNotifications") - 1]).toBe("-weak_framework");
  });

  it("passes OTHER_LDFLAGS through verbatim", () => {
    const args = buildLinkerArgs(baseInput({ settings: { OTHER_LDFLAGS: ["-ObjC", "-lz"] } }));
    expect(args).toContain("-ObjC");
    expect(args).toContain("-lz");
  });

  it("emits swift AST paths", () => {
    const args = buildLinkerArgs(baseInput({ swiftModulesToEmbed: ["/m/App.swiftmodule"] }));
    const idx = args.indexOf("/m/App.swiftmodule");
    expect(args[idx - 1]).toBe("-Xlinker");
    expect(args[idx - 2]).toBe("-add_ast_path");
    expect(args[idx - 3]).toBe("-Xlinker");
  });

  it("emits xcode default linker toggles", () => {
    const args = buildLinkerArgs(baseInput());
    expect(args.join(" ")).toContain("-Xlinker -dead_strip");
    expect(args).toContain("-rdynamic");
    expect(args.join(" ")).toContain("-Xlinker -no_deduplicate");
    expect(args).toContain("-fobjc-link-runtime");
    expect(args).toContain("-ObjC");
    expect(args).toContain("-lc++");
  });

  it("omits -lc++ when CLANG_CXX_LIBRARY is none", () => {
    const args = buildLinkerArgs(baseInput({ settings: { CLANG_CXX_LIBRARY: "none" } }));
    expect(args).not.toContain("-lc++");
  });
});

function baseInput(
  overrides: Partial<Parameters<typeof buildLinkerArgs>[0]> = {},
): Parameters<typeof buildLinkerArgs>[0] {
  return {
    settings: {},
    context: CTX,
    productType: "com.apple.product-type.application",
    productModuleName: "App",
    objectFiles: ["/o/a.o"],
    outputPath: "/out/App",
    sdkPath: SDK_PATH,
    ...overrides,
  };
}
