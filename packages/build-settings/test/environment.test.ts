import { describe, expect, it } from "vitest";
import { buildXcodeEnvironment, resolveTargetSettings, type BuildContext } from "../src/index.js";

const ctx: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("buildXcodeEnvironment", () => {
  it("returns SRCROOT + PROJECT_DIR equal to the input projectDir", () => {
    const env = buildXcodeEnvironment({
      projectDir: "/home/u/proj/ios",
      context: ctx,
      targetName: "App",
    });
    expect(env.SRCROOT).toBe("/home/u/proj/ios");
    expect(env.PROJECT_DIR).toBe("/home/u/proj/ios");
  });

  it("derives PROJECT_NAME from the projectDir basename", () => {
    const env = buildXcodeEnvironment({ projectDir: "/a/b/ios", context: ctx, targetName: "X" });
    expect(env.PROJECT_NAME).toBe("ios");
  });

  it("CONFIGURATION mirrors context.config", () => {
    expect(buildXcodeEnvironment({ projectDir: "/p", context: ctx, targetName: "T" }).CONFIGURATION)
      .toBe("Debug");
    expect(buildXcodeEnvironment({ projectDir: "/p", context: { ...ctx, config: "Release" }, targetName: "T" }).CONFIGURATION)
      .toBe("Release");
  });

  it("EFFECTIVE_PLATFORM_NAME has leading dash; PLATFORM_NAME does not", () => {
    const env = buildXcodeEnvironment({ projectDir: "/p", context: ctx, targetName: "T" });
    expect(env.EFFECTIVE_PLATFORM_NAME).toBe("-iphoneos");
    expect(env.PLATFORM_NAME).toBe("iphoneos");
  });

  it("simulator sdk produces iphonesimulator platform", () => {
    const env = buildXcodeEnvironment({
      projectDir: "/p",
      context: { sdk: "iphonesimulator17.0", arch: "arm64", config: "Debug" },
      targetName: "T",
    });
    expect(env.PLATFORM_NAME).toBe("iphonesimulator");
    expect(env.EFFECTIVE_PLATFORM_NAME).toBe("-iphonesimulator");
  });

  it("synthesizes BUILD_DIR + CONFIGURATION_BUILD_DIR with config-platform suffix", () => {
    const env = buildXcodeEnvironment({ projectDir: "/home/u/proj/ios", context: ctx, targetName: "App" });
    expect(env.BUILD_DIR).toBe("/home/u/proj/ios/build");
    expect(env.CONFIGURATION_BUILD_DIR).toBe("/home/u/proj/ios/build/Debug-iphoneos");
    expect(env.BUILT_PRODUCTS_DIR).toBe("/home/u/proj/ios/build/Debug-iphoneos");
  });

  it("honors explicit buildDir override", () => {
    const env = buildXcodeEnvironment({
      projectDir: "/p", context: ctx, targetName: "T",
      buildDir: "/tmp/custom",
    });
    expect(env.BUILD_DIR).toBe("/tmp/custom");
    expect(env.BUILT_PRODUCTS_DIR).toBe("/tmp/custom/Debug-iphoneos");
  });

  it("ARCHS + CURRENT_ARCH mirror context.arch", () => {
    const env = buildXcodeEnvironment({ projectDir: "/p", context: ctx, targetName: "T" });
    expect(env.ARCHS).toBe("arm64");
    expect(env.CURRENT_ARCH).toBe("arm64");
  });
});

describe("buildXcodeEnvironment SDKROOT", () => {
  it("defaults SDKROOT to the bare platform name when sdkPath is unset", () => {
    const env = buildXcodeEnvironment({
      projectDir: "/p",
      context: ctx,
      targetName: "App",
    });
    expect(env.SDKROOT).toBe("iphoneos");
  });

  it("sets SDKROOT to the provided sdkPath (absolute)", () => {
    const env = buildXcodeEnvironment({
      projectDir: "/p",
      context: ctx,
      targetName: "App",
      sdkPath: "/abs/path/to/iPhoneOS.sdk",
    });
    expect(env.SDKROOT).toBe("/abs/path/to/iPhoneOS.sdk");
  });
});

describe("resolveTargetSettings — with environment seed", () => {
  it("xcconfig PODS_ROOT = ${SRCROOT}/Pods substitutes when SRCROOT is in environment", () => {
    const resolved = resolveTargetSettings({
      xcconfigs: [
        {
          path: "/synthetic.xcconfig",
          settings: [
            { key: "PODS_ROOT", condition: null, value: "${SRCROOT}/Pods" },
            { key: "HEADER_SEARCH_PATHS", condition: null, value: ["$(PODS_ROOT)/Headers/Public"] },
          ],
          includes: [],
        },
      ],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: {},
      context: ctx,
      environment: buildXcodeEnvironment({ projectDir: "/home/u/proj/ios", context: ctx, targetName: "App" }),
    });
    expect(resolved.PODS_ROOT).toBe("/home/u/proj/ios/Pods");
    expect(resolved.HEADER_SEARCH_PATHS).toEqual(["/home/u/proj/ios/Pods/Headers/Public"]);
  });

  it("xcconfigs can override environment (precedence: env < xcconfig)", () => {
    const resolved = resolveTargetSettings({
      xcconfigs: [
        {
          path: "/override.xcconfig",
          settings: [{ key: "SRCROOT", condition: null, value: "/overridden" }],
          includes: [],
        },
      ],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: {},
      context: ctx,
      environment: { SRCROOT: "/from-env" },
    });
    expect(resolved.SRCROOT).toBe("/overridden");
  });

  it("environment-only resolve (no xcconfigs) returns the env unchanged", () => {
    const env = { SRCROOT: "/x", CONFIGURATION: "Debug" };
    const resolved = resolveTargetSettings({
      xcconfigs: [],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: {},
      context: ctx,
      environment: env,
    });
    expect(resolved).toEqual(env);
  });

  it("backward compat: omitting environment behaves like Plan-2 (empty initial layer)", () => {
    // Same input as the first test above but without an `environment` — PODS_ROOT
    // should substitute SRCROOT to empty string.
    const resolved = resolveTargetSettings({
      xcconfigs: [
        {
          path: "/synthetic.xcconfig",
          settings: [
            { key: "PODS_ROOT", condition: null, value: "${SRCROOT}/Pods" },
          ],
          includes: [],
        },
      ],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: {},
      context: ctx,
      // no environment
    });
    expect(resolved.PODS_ROOT).toBe("/Pods"); // SRCROOT undefined → empty substitution
  });
});
