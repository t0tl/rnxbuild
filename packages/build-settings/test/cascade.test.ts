import { describe, expect, it } from "vitest";
import {
  resolveTargetSettings,
  type CascadeInput,
  type BuildContext,
} from "../src/index.js";

const ctx: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("resolveTargetSettings", () => {
  it("cascades xcconfig → project → target → configuration", () => {
    const input: CascadeInput = {
      xcconfigs: [
        { path: "/Target.xcconfig", settings: [{ key: "FROM_XCCONFIG", condition: null, value: "xcconfig" }], includes: [] },
      ],
      projectSettings: { FROM_PROJECT: "project" },
      targetSettings: { FROM_TARGET: "target" },
      configurationSettings: { FROM_CONFIG: "config" },
      context: ctx,
    };
    const out = resolveTargetSettings(input);
    expect(out.FROM_XCCONFIG).toBe("xcconfig");
    expect(out.FROM_PROJECT).toBe("project");
    expect(out.FROM_TARGET).toBe("target");
    expect(out.FROM_CONFIG).toBe("config");
  });

  it("later layers override earlier ones for the same key", () => {
    const input: CascadeInput = {
      xcconfigs: [
        { path: "/Target.xcconfig", settings: [{ key: "ARCHS", condition: null, value: "armv7" }], includes: [] },
      ],
      projectSettings: { ARCHS: "armv7 arm64" },
      targetSettings: {},
      configurationSettings: { ARCHS: "arm64" },
      context: ctx,
    };
    expect(resolveTargetSettings(input).ARCHS).toBe("arm64");
  });

  it("$(inherited) at each layer picks up the layer below", () => {
    const input: CascadeInput = {
      xcconfigs: [
        { path: "/Target.xcconfig", settings: [{ key: "OTHER_LDFLAGS", condition: null, value: "-framework A" }], includes: [] },
      ],
      projectSettings: { OTHER_LDFLAGS: "$(inherited) -framework B" },
      targetSettings: { OTHER_LDFLAGS: "$(inherited) -framework C" },
      configurationSettings: { OTHER_LDFLAGS: "$(inherited) -framework D" },
      context: ctx,
    };
    expect(resolveTargetSettings(input).OTHER_LDFLAGS).toBe(
      "-framework A -framework B -framework C -framework D",
    );
  });

  it("filters out conditional entries that do not match the context", () => {
    const input: CascadeInput = {
      xcconfigs: [
        {
          path: "/Target.xcconfig",
          settings: [
            { key: "FRAMEWORK_SEARCH_PATHS", condition: "sdk=iphonesimulator*", value: "/sim" },
            { key: "FRAMEWORK_SEARCH_PATHS", condition: "sdk=iphoneos*", value: "/device" },
            { key: "FRAMEWORK_SEARCH_PATHS", condition: null, value: "/base" },
          ],
          includes: [],
        },
      ],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: {},
      context: ctx,
    };
    expect(resolveTargetSettings(input).FRAMEWORK_SEARCH_PATHS).toBe("/device");
  });
});

describe("resolveTargetSettings — array-valued settings", () => {
  it("preserves array OTHER_LDFLAGS through the cascade with $(inherited)", () => {
    const input: CascadeInput = {
      xcconfigs: [
        {
          path: "/Base.xcconfig",
          settings: [{ key: "OTHER_LDFLAGS", condition: null, value: ["-framework", "Base"] }],
          includes: [],
        },
      ],
      projectSettings: { OTHER_LDFLAGS: ["$(inherited)", "-framework", "Proj"] },
      targetSettings: {},
      configurationSettings: { OTHER_LDFLAGS: ["$(inherited)", "-framework", "Cfg"] },
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
    };
    expect(resolveTargetSettings(input).OTHER_LDFLAGS).toEqual([
      "-framework", "Base",
      "-framework", "Proj",
      "-framework", "Cfg",
    ]);
  });
});

describe("resolveTargetSettings — pbxproj array child + xcconfig array parent (Plan-3 Wall A regression)", () => {
  it("a tokenized pbxproj $(inherited) child correctly element-wise prepends the xcconfig parent array", () => {
    // This mirrors what happens after P3T4 lands: workspace-parser tokenizes
    // OTHER_SWIFT_FLAGS = "$(inherited) -D FOO" into ["$(inherited)", "-D", "FOO"]
    // before it reaches the cascade. The cascade must then element-wise expand
    // $(inherited) against the xcconfig's contributed array, NOT space-join.
    const input: CascadeInput = {
      xcconfigs: [
        {
          path: "/X.xcconfig",
          settings: [
            {
              key: "OTHER_SWIFT_FLAGS",
              condition: null,
              value: ["-Xcc", "-fmodule-map-file=/m1", "-Xcc", "-fmodule-map-file=/m2"],
            },
          ],
          includes: [],
        },
      ],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: {
        // post-P3T4 this is an ARRAY (tokenized from "$(inherited) -D FOO")
        OTHER_SWIFT_FLAGS: ["$(inherited)", "-D", "FOO"],
      },
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
    };
    expect(resolveTargetSettings(input).OTHER_SWIFT_FLAGS).toEqual([
      "-Xcc",
      "-fmodule-map-file=/m1",
      "-Xcc",
      "-fmodule-map-file=/m2",
      "-D",
      "FOO",
    ]);
  });

  it("does NOT space-join when both layers are arrays (key regression)", () => {
    // If this test fails with one big string, the cascade is re-flattening
    // arrays — the exact bug that caused Plan-3 Wall A's `unexpected input file`
    // error against fixture-01-bare.
    const input: CascadeInput = {
      xcconfigs: [
        {
          path: "/X.xcconfig",
          settings: [{ key: "OTHER_LDFLAGS", condition: null, value: ["-framework", "Foo"] }],
          includes: [],
        },
      ],
      projectSettings: {},
      targetSettings: {},
      configurationSettings: { OTHER_LDFLAGS: ["$(inherited)", "-framework", "Bar"] },
      context: { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" },
    };
    const result = resolveTargetSettings(input).OTHER_LDFLAGS;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(["-framework", "Foo", "-framework", "Bar"]);
  });
});
