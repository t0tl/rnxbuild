import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildContext } from "@rnxbuild/build-settings";
import { rewriteFrameworkSearchPaths } from "../src/framework.js";

const DEVICE_CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };
const SIM_CTX: BuildContext = { sdk: "iphonesimulator17.0", arch: "arm64", config: "Debug" };

describe("rewriteFrameworkSearchPaths", () => {
  let podsRoot: string;
  let tmpRoot: string;

  beforeAll(async () => {
    // Build a tiny fake CocoaPods tree mirroring the three discovery shapes
    // we observe in fixture-01-bare:
    //   1. ${podsRoot}/<name>/<X>.xcframework/...                  (React-Core-prebuilt)
    //   2. ${podsRoot}/<name>/framework/packages/react-native/...  (ReactNativeDependencies)
    //   3. ${podsRoot}/<name>/destroot/Library/Frameworks/universal/...  (hermes-engine)
    tmpRoot = await mkdtemp(join(tmpdir(), "rnxb-fw-paths-"));
    podsRoot = join(tmpRoot, "Pods");

    // Shape 1: React-Core-prebuilt — note xcframework NAME differs from POD NAME
    const reactSlices = [
      "ios-arm64",
      "ios-arm64_x86_64-simulator",
      "ios-arm64_x86_64-maccatalyst",
    ];
    for (const slice of reactSlices) {
      await mkdir(
        join(podsRoot, "React-Core-prebuilt", "React.xcframework", slice, "React.framework"),
        { recursive: true },
      );
    }

    // Shape 2: ReactNativeDependencies under deep subpath
    for (const slice of ["ios-arm64", "ios-arm64_x86_64-simulator"]) {
      await mkdir(
        join(
          podsRoot,
          "ReactNativeDependencies",
          "framework",
          "packages",
          "react-native",
          "ReactNativeDependencies.xcframework",
          slice,
          "ReactNativeDependencies.framework",
        ),
        { recursive: true },
      );
    }

    // Shape 3: hermes-engine under destroot path
    for (const slice of ["ios-arm64", "ios-arm64_x86_64-simulator"]) {
      await mkdir(
        join(
          podsRoot,
          "hermes-engine",
          "destroot",
          "Library",
          "Frameworks",
          "universal",
          "hermesvm.xcframework",
          slice,
          "hermesvm.framework",
        ),
        { recursive: true },
      );
    }

    // An entry that DOES exist on disk — should be left as-is
    await mkdir(join(podsRoot, "PreExisting"), { recursive: true });
    await writeFile(join(podsRoot, "PreExisting", ".keep"), "");
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("rewrites missing FRAMEWORK_SEARCH_PATHS entry to the device per-arch slice (array setting)", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/build-time-missing/React-Core-prebuilt"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64`,
    ]);
  });

  it("rewrites missing FRAMEWORK_SEARCH_PATHS entry when value is a scalar string", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: "/build-time-missing/React-Core-prebuilt",
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toBe(
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64`,
    );
  });

  it("leaves entries that already exist on disk unchanged", async () => {
    const existing = `${podsRoot}/PreExisting`;
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: [existing],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([existing]);
  });

  it("rewrites an existing directory containing an xcframework to its selected slice", async () => {
    const existingXcframeworkParent = `${podsRoot}/React-Core-prebuilt`;
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: [existingXcframeworkParent],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64`,
    ]);
  });

  it("prefers exact ios-arm64 over ios-arm64_x86_64-simulator on iphoneos device builds", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/React-Core-prebuilt"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64`,
    ]);
  });

  it("picks the simulator slice on iphonesimulator builds", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/React-Core-prebuilt"],
      },
      { podsRoot, context: SIM_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64_x86_64-simulator`,
    ]);
  });

  it("discovers xcframework under deep subpath (ReactNativeDependencies shape)", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/ReactNativeDependencies"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/ReactNativeDependencies/framework/packages/react-native/ReactNativeDependencies.xcframework/ios-arm64`,
    ]);
  });

  it("discovers xcframework under hermes-engine destroot subpath", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/hermes-engine"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework/ios-arm64`,
    ]);
  });

  it("walks up the entry path when the basename doesn't match a Pods/ subdirectory (hermes 'Pre-built' shape)", async () => {
    // CocoaPods sometimes appends a sub-segment like 'Pre-built' to the
    // build-time path. The basename ('Pre-built') doesn't match any Pods/
    // child directory, so the resolver must walk UP the path looking for a
    // segment that does — landing on 'hermes-engine' here.
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/hermes-engine/Pre-built"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      `${podsRoot}/hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework/ios-arm64`,
    ]);
  });

  it("leaves the entry unchanged when no matching arch slice exists", async () => {
    // tvos build context — none of our synthetic xcframeworks have a tvos slice
    const tvosCtx: BuildContext = { sdk: "appletvos17.0", arch: "arm64", config: "Debug" };
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/React-Core-prebuilt"],
      },
      { podsRoot, context: tvosCtx },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual(["/missing/React-Core-prebuilt"]);
  });

  it("leaves the entry unchanged when no .xcframework can be found at any candidate root", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: ["/missing/NonExistentPod"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual(["/missing/NonExistentPod"]);
  });

  it("preserves $(inherited) literal tokens", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: [
          "$(inherited)",
          "/missing/React-Core-prebuilt",
        ],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      "$(inherited)",
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64`,
    ]);
  });

  it("preserves token order within an array, rewriting only what needs it", async () => {
    const existing = `${podsRoot}/PreExisting`;
    const result = await rewriteFrameworkSearchPaths(
      {
        FRAMEWORK_SEARCH_PATHS: [
          "$(inherited)",
          existing,
          "/missing/React-Core-prebuilt",
          "/missing/ReactNativeDependencies",
        ],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
      "$(inherited)",
      existing,
      `${podsRoot}/React-Core-prebuilt/React.xcframework/ios-arm64`,
      `${podsRoot}/ReactNativeDependencies/framework/packages/react-native/ReactNativeDependencies.xcframework/ios-arm64`,
    ]);
  });

  it("does NOT touch settings other than FRAMEWORK_SEARCH_PATHS", async () => {
    const result = await rewriteFrameworkSearchPaths(
      {
        SWIFT_VERSION: "5.0",
        OTHER_SWIFT_FLAGS: ["-D", "FOO"],
        HEADER_SEARCH_PATHS: ["/missing/React-Core-prebuilt"],
      },
      { podsRoot, context: DEVICE_CTX },
    );
    expect(result.SWIFT_VERSION).toBe("5.0");
    expect(result.OTHER_SWIFT_FLAGS).toEqual(["-D", "FOO"]);
    expect(result.HEADER_SEARCH_PATHS).toEqual(["/missing/React-Core-prebuilt"]);
  });

  it("does NOT mutate the input settings dict (purity)", async () => {
    const input = {
      FRAMEWORK_SEARCH_PATHS: ["/missing/React-Core-prebuilt"],
    };
    const result = await rewriteFrameworkSearchPaths(input, {
      podsRoot,
      context: DEVICE_CTX,
    });
    expect(input.FRAMEWORK_SEARCH_PATHS).toEqual(["/missing/React-Core-prebuilt"]);
    expect(result.FRAMEWORK_SEARCH_PATHS).not.toBe(input.FRAMEWORK_SEARCH_PATHS);
  });

  it("does NOT match an ios-arm64e slice for an arch:arm64 build (word-boundary, not substring)", async () => {
    // Synthetic xcframework with ONLY an ios-arm64e slice. The naive
    // `slice.includes("arm64")` check would have returned a false positive,
    // selecting an arm64e binary at link time. Expect: no match, so the
    // original entry is preserved.
    const arm64eOnlyRoot = await mkdtemp(join(tmpdir(), "rnxb-arm64e-only-"));
    const arm64eOnlyPods = join(arm64eOnlyRoot, "Pods");
    await mkdir(
      join(arm64eOnlyPods, "Arm64eOnly", "Arm64eOnly.xcframework", "ios-arm64e", "Arm64eOnly.framework"),
      { recursive: true },
    );
    try {
      const result = await rewriteFrameworkSearchPaths(
        {
          FRAMEWORK_SEARCH_PATHS: ["/missing/Arm64eOnly"],
        },
        { podsRoot: arm64eOnlyPods, context: DEVICE_CTX },
      );
      expect(result.FRAMEWORK_SEARCH_PATHS).toEqual(["/missing/Arm64eOnly"]);

      // Add a sibling ios-arm64 slice and re-run: ios-arm64 must win, not ios-arm64e.
      await mkdir(
        join(arm64eOnlyPods, "Arm64eOnly", "Arm64eOnly.xcframework", "ios-arm64", "Arm64eOnly.framework"),
        { recursive: true },
      );
      const result2 = await rewriteFrameworkSearchPaths(
        {
          FRAMEWORK_SEARCH_PATHS: ["/missing/Arm64eOnly"],
        },
        { podsRoot: arm64eOnlyPods, context: DEVICE_CTX },
      );
      expect(result2.FRAMEWORK_SEARCH_PATHS).toEqual([
        `${arm64eOnlyPods}/Arm64eOnly/Arm64eOnly.xcframework/ios-arm64`,
      ]);
    } finally {
      await rm(arm64eOnlyRoot, { recursive: true, force: true });
    }
  });

  it("picks xcframework deterministically (alphabetical) when multiple siblings exist", async () => {
    // Two sibling .xcframework dirs under the same candidate root. readdir
    // order is filesystem-dependent; the rewriter must sort to guarantee a
    // reproducible choice across CI, dev boxes, and rebuilds.
    const multiRoot = await mkdtemp(join(tmpdir(), "rnxb-multi-xcfw-"));
    const multiPods = join(multiRoot, "Pods");
    for (const name of ["Beta", "Apple"]) {
      await mkdir(
        join(multiPods, "MultiPod", `${name}.xcframework`, "ios-arm64", `${name}.framework`),
        { recursive: true },
      );
    }
    try {
      const result = await rewriteFrameworkSearchPaths(
        {
          FRAMEWORK_SEARCH_PATHS: ["/missing/MultiPod"],
        },
        { podsRoot: multiPods, context: DEVICE_CTX },
      );
      expect(result.FRAMEWORK_SEARCH_PATHS).toEqual([
        `${multiPods}/MultiPod/Apple.xcframework/ios-arm64`,
      ]);
    } finally {
      await rm(multiRoot, { recursive: true, force: true });
    }
  });
});
