import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLinkerArgs } from "../src/args.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(
  here,
  "../../../fixtures/01-bare/expected/app-build/ld-01bare-debug-dylib.txt",
);

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };
const SDK =
  "/Applications/Xcode-26.5.0.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.5.sdk";

describe("linker goldens parity", () => {
  it("contains canonical flags and link refs from the xcodebuild ld golden", async () => {
    const golden = await readFile(goldenPath, "utf8");
    const args = buildLinkerArgs({
      settings: {
        IPHONEOS_DEPLOYMENT_TARGET: "16.4",
        FRAMEWORK_SEARCH_PATHS: ["/F1", "/F2"],
        LIBRARY_SEARCH_PATHS: ["/L1"],
        OTHER_LDFLAGS: ["-ObjC", "-lc++"],
      },
      context: CTX,
      productType: "com.apple.product-type.framework",
      productModuleName: "_1bare",
      objectFiles: ["/o/a.o"],
      outputPath: "/out/01bare.debug.dylib",
      sdkPath: SDK,
      staticLibraries: ["EXConstants", "ExpoLogBox"],
      frameworks: ["UIKit", "React"],
      weakFrameworks: ["JavaScriptCore"],
    });
    const joined = args.join(" ");

    for (const flag of [
      "-Xlinker",
      "-reproducible",
      "-target",
      "-isysroot",
      "-dead_strip",
      "-rdynamic",
      "-no_deduplicate",
    ]) {
      expect(args, `missing flag: ${flag}`).toContain(flag);
    }

    expect(joined).toContain("-rpath -Xlinker /usr/lib/swift");
    expect(joined).toContain("-rpath -Xlinker @executable_path/Frameworks");
    expect(joined).toContain("-rpath -Xlinker @loader_path/Frameworks");
    expect(args).toContain("-dynamiclib");
    expect(args).toContain("-install_name");
    expect(joined).toContain("-framework UIKit");
    expect(joined).toContain("-framework React");
    expect(joined).toContain("-weak_framework JavaScriptCore");
    expect(joined).toContain("-lEXConstants");
    expect(joined).toContain("-lExpoLogBox");
    expect(args).toContain("-ObjC");

    expect(golden).toContain("-framework UIKit");
    expect(golden).toContain("-weak_framework JavaScriptCore");
  });

  it("does not emit punted Previews, LTO, or dependency-info flags", () => {
    const args = buildLinkerArgs({
      settings: {},
      context: CTX,
      productType: "com.apple.product-type.application",
      productModuleName: "App",
      objectFiles: ["/o/a.o"],
      outputPath: "/out/App",
      sdkPath: SDK,
    });

    expect(args).not.toContain("-sectcreate");
    expect(args).not.toContain("__debug_dylib");
    expect(args).not.toContain("__debug_main_executable_dylib_entry_point");
    expect(args).not.toContain("-object_path_lto");
    expect(args).not.toContain("-dependency_info");
  });
});
