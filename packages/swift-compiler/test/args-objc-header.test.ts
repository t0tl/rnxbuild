import { describe, expect, it } from "vitest";
import { buildSwiftcArgs } from "../src/args.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("buildSwiftcArgs — emitObjCHeader + swiftModuleSearchPaths", () => {
  it("adds -emit-objc-header and -emit-objc-header-path when emitObjCHeader is true", () => {
    const args = buildSwiftcArgs({
      settings: { DEFINES_MODULE: "YES" },
      context: CTX,
      sources: ["/src/a.swift"],
      outputDir: "/out",
      moduleName: "Foo",
      emitObjCHeader: true,
      objCHeaderOutputDir: "/out/headers",
    });
    expect(args).toContain("-emit-objc-header");
    const idx = args.indexOf("-emit-objc-header-path");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/out/headers/Foo-Swift.h");
  });

  it("does NOT add -emit-objc-header when emitObjCHeader is false or undefined", () => {
    const args = buildSwiftcArgs({
      settings: { DEFINES_MODULE: "YES" },
      context: CTX,
      sources: ["/src/a.swift"],
      outputDir: "/out",
      moduleName: "Foo",
    });
    expect(args).not.toContain("-emit-objc-header");
    expect(args).not.toContain("-emit-objc-header-path");
  });

  it("adds -I for each swiftModuleSearchPaths entry", () => {
    const args = buildSwiftcArgs({
      settings: {},
      context: CTX,
      sources: ["/src/a.swift"],
      outputDir: "/out",
      moduleName: "Foo",
      swiftModuleSearchPaths: ["/build/A/swiftmodule", "/build/B/swiftmodule"],
    });
    const aIdx = args.indexOf("/build/A/swiftmodule");
    expect(aIdx).toBeGreaterThan(-1);
    expect(args[aIdx - 1]).toBe("-I");
    const bIdx = args.indexOf("/build/B/swiftmodule");
    expect(bIdx).toBeGreaterThan(-1);
    expect(args[bIdx - 1]).toBe("-I");
  });

  it("adds extraHeaderSearchPaths as Clang importer -I paths", () => {
    const args = buildSwiftcArgs({
      settings: {},
      context: CTX,
      sources: ["/src/a.swift"],
      outputDir: "/out",
      moduleName: "Foo",
      extraHeaderSearchPaths: ["/build/ExpoModulesCore/headers"],
    });
    const pathIdx = args.indexOf("/build/ExpoModulesCore/headers");
    expect(pathIdx).toBeGreaterThan(-1);
    expect(args[pathIdx - 1]).toBe("-Xcc");
    expect(args[pathIdx - 2]).toBe("-I");
    expect(args[pathIdx - 3]).toBe("-Xcc");
  });

  it("emits both module and objc header when DEFINES_MODULE=YES + emitObjCHeader=true", () => {
    const args = buildSwiftcArgs({
      settings: { DEFINES_MODULE: "YES" },
      context: CTX,
      sources: ["/src/a.swift"],
      outputDir: "/out",
      moduleName: "Foo",
      emitObjCHeader: true,
      objCHeaderOutputDir: "/out/headers",
    });
    expect(args).toContain("-emit-module");
    expect(args).toContain("-emit-objc-header");
  });
});
