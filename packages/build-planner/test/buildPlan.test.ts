import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/buildPlan.js";
import type { XcodeProject } from "@rnxbuild/workspace-parser";
import type { BuildContext, SettingsDict } from "@rnxbuild/build-settings";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

function fakeProject(opts: {
  path: string;
  targets: {
    id: string;
    name: string;
    productType: string;
    debugSettings: SettingsDict;
    deps?: string[];
  }[];
}): XcodeProject {
  return {
    path: opts.path,
    targets: opts.targets.map((t) => ({
      id: t.id,
      name: t.name,
      productType: t.productType,
      configurations: [
        { name: "Debug", buildSettings: t.debugSettings, baseConfigurationReference: undefined },
      ],
      buildPhaseIds: [],
      dependencies: t.deps ?? [],
    })),
    projectConfigurations: [{ name: "Debug", buildSettings: {} }],
    objects: {},
  };
}

describe("buildPlan", () => {
  it("produces a BuildPlan with one target per PBXNativeTarget", async () => {
    const mainProject = fakeProject({
      path: "/p/Main.xcodeproj",
      targets: [
        {
          id: "T_APP",
          name: "App",
          productType: "com.apple.product-type.application",
          debugSettings: { PRODUCT_MODULE_NAME: "App" },
        },
      ],
    });

    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: "/p/Pods",
      sourcesByTargetId: { T_APP: ["/p/src/AppDelegate.swift", "/p/src/AppDelegate.mm"] },
    });

    expect(plan.targets).toHaveLength(1);
    const t = plan.targets[0]!;
    expect(t.id).toBe("T_APP");
    expect(t.name).toBe("App");
    expect(t.productModuleName).toBe("App");
    expect(t.sources.swift).toEqual(["/p/src/AppDelegate.swift"]);
    expect(t.sources.objcpp).toEqual(["/p/src/AppDelegate.mm"]);
  });

  it("derives productModuleName from PRODUCT_MODULE_NAME with fallback to name", async () => {
    const mainProject = fakeProject({
      path: "/p/Main.xcodeproj",
      targets: [
        {
          id: "T_X",
          name: "Hyphen-Name",
          productType: "com.apple.product-type.library.static",
          debugSettings: {},
        },
      ],
    });

    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: "/p/Pods",
      sourcesByTargetId: { T_X: [] },
    });
    expect(plan.targets[0]!.productModuleName).toBe("Hyphen-Name");
  });

  it("merges main + pods projects into a single plan", async () => {
    const mainProject = fakeProject({
      path: "/p/Main.xcodeproj",
      targets: [{
        id: "T_APP",
        name: "App",
        productType: "com.apple.product-type.application",
        debugSettings: {},
      }],
    });
    const podsProject = fakeProject({
      path: "/p/Pods/Pods.xcodeproj",
      targets: [{
        id: "T_LIB",
        name: "Lib",
        productType: "com.apple.product-type.library.static",
        debugSettings: {},
      }],
    });

    const plan = await buildPlan({
      mainProject,
      podsProject,
      context: CTX,
      podsRoot: "/p/Pods",
      sourcesByTargetId: { T_APP: [], T_LIB: [] },
    });
    expect(plan.targets.map((t) => t.id).sort()).toEqual(["T_APP", "T_LIB"]);
  });

  it("threads context + podsRoot through to the plan", async () => {
    const mainProject = fakeProject({
      path: "/p/Main.xcodeproj",
      targets: [],
    });
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: "/p/Pods",
      sourcesByTargetId: {},
    });
    expect(plan.context).toEqual(CTX);
    expect(plan.podsRoot).toBe("/p/Pods");
  });
});

describe("buildPlan xcconfig chain loading", () => {
  it("loads each target's xcconfig chain via baseConfigurationReference and threads it into the cascade", async () => {
    // Create a synthetic xcodeproj dir + xcconfig on disk so resolveFileReferencePath can find them.
    const root = await mkdtemp(join(tmpdir(), "rnxb-bp-xcconfig-"));
    const projectPath = join(root, "Sample.xcodeproj");
    await mkdir(projectPath, { recursive: true });
    const xcconfigPath = join(root, "App.debug.xcconfig");
    await writeFile(
      xcconfigPath,
      `OTHER_LDFLAGS = $(inherited) -l "ExpoFoo"
FRAMEWORK_SEARCH_PATHS = $(inherited) "\${PODS_CONFIGURATION_BUILD_DIR}/ExpoFoo"
`,
      "utf8",
    );

    const mainProject: XcodeProject = {
      path: projectPath,
      targets: [
        {
          id: "T_APP",
          name: "App",
          productType: "com.apple.product-type.application",
          configurations: [{
            name: "Debug",
            buildSettings: {},
            baseConfigurationReference: "REF_XCCONFIG",
          }],
          buildPhaseIds: [],
          dependencies: [],
        },
        {
          id: "T_DEP",
          name: "ExpoFoo",
          productType: "com.apple.product-type.library.static",
          configurations: [{
            name: "Debug",
            buildSettings: {},
            baseConfigurationReference: undefined,
          }],
          buildPhaseIds: [],
          dependencies: [],
        },
      ],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {
        REF_XCCONFIG: {
          isa: "PBXFileReference",
          path: "App.debug.xcconfig",
          sourceTree: "<absolute>",
        },
      },
    };
    // <absolute> sourceTree wants the path TO be absolute — re-bind:
    (mainProject.objects.REF_XCCONFIG as Record<string, unknown>).path = xcconfigPath;

    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: join(root, "Pods"),
      sourcesByTargetId: { T_APP: [], T_DEP: [] },
    });

    const app = plan.targets.find((t) => t.id === "T_APP")!;
    // The xcconfig values should now appear in resolved settings:
    expect(app.settings.OTHER_LDFLAGS).toBeDefined();
    expect(JSON.stringify(app.settings.OTHER_LDFLAGS)).toContain("ExpoFoo");
    // And the deriveDeps heuristic over OTHER_LDFLAGS should pick up T_DEP:
    expect(app.deps).toContain("T_DEP");
  });

  it("falls back to empty xcconfigs when baseConfigurationReference is undefined", async () => {
    const mainProject: XcodeProject = {
      path: "/fake/Sample.xcodeproj",
      targets: [
        {
          id: "T_A",
          name: "A",
          productType: "com.apple.product-type.library.static",
          configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
          buildPhaseIds: [],
          dependencies: [],
        },
      ],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: "/fake/Pods",
      sourcesByTargetId: { T_A: [] },
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]!.deps).toEqual([]);
  });
});

describe("buildPlan per-project environment (Wall G2)", () => {
  it("synthesizes SRCROOT per project: main targets get main proj dir, pods targets get pods proj dir", async () => {
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_APP", name: "App",
        productType: "com.apple.product-type.application",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const podsProject: XcodeProject = {
      path: "/abs/main/Pods/Pods.xcodeproj",
      targets: [{
        id: "T_POD", name: "ExpoFoo",
        productType: "com.apple.product-type.library.static",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };

    const plan = await buildPlan({
      mainProject, podsProject,
      context: CTX,
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_APP: [], T_POD: [] },
    });

    const app = plan.targets.find((t) => t.id === "T_APP")!;
    const pod = plan.targets.find((t) => t.id === "T_POD")!;
    expect(app.settings.SRCROOT).toBe("/abs/main");
    expect(pod.settings.SRCROOT).toBe("/abs/main/Pods");
  });

  it("merges extraEnvironment on top of the per-project env (caller can override SDKROOT etc.)", async () => {
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_APP", name: "App",
        productType: "com.apple.product-type.application",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };

    const plan = await buildPlan({
      mainProject,
      context: CTX,
      extraEnvironment: { SDKROOT: "/abs/sdk/iPhoneOS.sdk" },
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_APP: [] },
    });

    expect(plan.targets[0]!.settings.SDKROOT).toBe("/abs/sdk/iPhoneOS.sdk");
    // SRCROOT still comes from the per-project synthesis
    expect(plan.targets[0]!.settings.SRCROOT).toBe("/abs/main");
  });

  it("works without extraEnvironment (backward-compatible)", async () => {
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_X", name: "X",
        productType: "com.apple.product-type.library.static",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_X: [] },
    });
    expect(plan.targets[0]!.settings.SRCROOT).toBe("/abs/main");
    // SDKROOT defaults to bare platform name when not overridden
    expect(plan.targets[0]!.settings.SDKROOT).toBe("iphoneos");
  });
});

describe("buildPlan sdkPath override (Wall G3)", () => {
  it("overrides settings.SDKROOT with sdkPath EVEN WHEN projectSettings sets SDKROOT", async () => {
    // Reproduces the real-world pattern: pbxproj sets `SDKROOT = iphoneos` at
    // the project level; our caller knows the absolute path and wants it used.
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_APP", name: "App",
        productType: "com.apple.product-type.application",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: { SDKROOT: "iphoneos" } }],
      objects: {},
    };
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      sdkPath: "/abs/sdk/iPhoneOS.sdk",
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_APP: [] },
    });
    expect(plan.targets[0]!.settings.SDKROOT).toBe("/abs/sdk/iPhoneOS.sdk");
  });

  it("overrides settings.SDKROOT with sdkPath EVEN WHEN configurationSettings (highest layer) sets SDKROOT", async () => {
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_APP", name: "App",
        productType: "com.apple.product-type.application",
        configurations: [{
          name: "Debug",
          buildSettings: { SDKROOT: "iphoneos" },                // ← highest cascade layer
          baseConfigurationReference: undefined,
        }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      sdkPath: "/abs/sdk/iPhoneOS.sdk",
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_APP: [] },
    });
    expect(plan.targets[0]!.settings.SDKROOT).toBe("/abs/sdk/iPhoneOS.sdk");
  });

  it("sdkPath wins over extraEnvironment.SDKROOT when both are provided", async () => {
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_APP", name: "App",
        productType: "com.apple.product-type.application",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: { SDKROOT: "iphoneos" } }],
      objects: {},
    };
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      sdkPath: "/abs/A/iPhoneOS.sdk",
      extraEnvironment: { SDKROOT: "/abs/B/iPhoneOS.sdk" },
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_APP: [] },
    });
    expect(plan.targets[0]!.settings.SDKROOT).toBe("/abs/A/iPhoneOS.sdk");
  });

  it("leaves SDKROOT alone (bare from project) when sdkPath is undefined", async () => {
    const mainProject: XcodeProject = {
      path: "/abs/main/Main.xcodeproj",
      targets: [{
        id: "T_APP", name: "App",
        productType: "com.apple.product-type.application",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: { SDKROOT: "iphoneos" } }],
      objects: {},
    };
    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot: "/abs/main/Pods",
      sourcesByTargetId: { T_APP: [] },
    });
    expect(plan.targets[0]!.settings.SDKROOT).toBe("iphoneos");
  });
});

describe("buildPlan synthesize MODULEMAP_FILE per pod (Wall H)", () => {
  it("injects MODULEMAP_FILE when Target Support Files/<name>/<name>.modulemap exists on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-bp-modulemap-"));
    const podsRoot = join(root, "Pods");
    // Create the canonical CocoaPods modulemap layout for one pod:
    await mkdir(join(podsRoot, "Target Support Files", "ExpoLogBox"), { recursive: true });
    await writeFile(
      join(podsRoot, "Target Support Files", "ExpoLogBox", "ExpoLogBox.modulemap"),
      "framework module ExpoLogBox {}\n",
      "utf8",
    );

    const podsProject: XcodeProject = {
      path: join(podsRoot, "Pods.xcodeproj"),
      targets: [{
        id: "T_BOX", name: "ExpoLogBox",
        productType: "com.apple.product-type.library.static",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const mainProject: XcodeProject = {
      path: join(root, "Main.xcodeproj"),
      targets: [],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };

    const plan = await buildPlan({
      mainProject, podsProject,
      context: CTX,
      podsRoot,
      sourcesByTargetId: { T_BOX: [] },
    });
    const box = plan.targets.find((t) => t.id === "T_BOX")!;
    expect(box.settings.MODULEMAP_FILE).toBe("Target Support Files/ExpoLogBox/ExpoLogBox.modulemap");
  });

  it("does NOT inject MODULEMAP_FILE when the file doesn't exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-bp-modulemap-no-"));
    const podsRoot = join(root, "Pods");

    const podsProject: XcodeProject = {
      path: join(podsRoot, "Pods.xcodeproj"),
      targets: [{
        id: "T_NOM", name: "NoModulemap",
        productType: "com.apple.product-type.library.static",
        configurations: [{ name: "Debug", buildSettings: {}, baseConfigurationReference: undefined }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const mainProject: XcodeProject = {
      path: join(root, "Main.xcodeproj"),
      targets: [],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };

    const plan = await buildPlan({
      mainProject, podsProject,
      context: CTX,
      podsRoot,
      sourcesByTargetId: { T_NOM: [] },
    });
    const nom = plan.targets.find((t) => t.id === "T_NOM")!;
    expect(nom.settings.MODULEMAP_FILE).toBeUndefined();
  });

  it("does NOT override MODULEMAP_FILE if any cascade layer already sets it (explicit wins)", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-bp-modulemap-pre-"));
    const podsRoot = join(root, "Pods");
    await mkdir(join(podsRoot, "Target Support Files", "Foo"), { recursive: true });
    await writeFile(
      join(podsRoot, "Target Support Files", "Foo", "Foo.modulemap"),
      "framework module Foo {}\n",
      "utf8",
    );

    const podsProject: XcodeProject = {
      path: join(podsRoot, "Pods.xcodeproj"),
      targets: [{
        id: "T_FOO", name: "Foo",
        productType: "com.apple.product-type.library.static",
        configurations: [{
          name: "Debug",
          buildSettings: { MODULEMAP_FILE: "explicit/path/Foo.modulemap" },  // ← caller set
          baseConfigurationReference: undefined,
        }],
        buildPhaseIds: [], dependencies: [],
      }],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };
    const mainProject: XcodeProject = {
      path: join(root, "Main.xcodeproj"),
      targets: [],
      projectConfigurations: [{ name: "Debug", buildSettings: {} }],
      objects: {},
    };

    const plan = await buildPlan({
      mainProject, podsProject,
      context: CTX,
      podsRoot,
      sourcesByTargetId: { T_FOO: [] },
    });
    const foo = plan.targets.find((t) => t.id === "T_FOO")!;
    expect(foo.settings.MODULEMAP_FILE).toBe("explicit/path/Foo.modulemap");
  });
});

describe("buildPlan relocatable fixture paths", () => {
  it("rebases stale absolute CocoaPods paths in resolved settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-bp-relocatable-"));
    const podsRoot = join(root, "App", "ios", "Pods");
    const vfsPath = join(podsRoot, "React-Core-prebuilt", "React-VFS.yaml");
    await mkdir(join(podsRoot, "React-Core-prebuilt"), { recursive: true });
    await writeFile(vfsPath, "{}\n", "utf8");

    const mainProject = fakeProject({
      path: join(root, "App", "ios", "Main.xcodeproj"),
      targets: [{
        id: "T_APP",
        name: "App",
        productType: "com.apple.product-type.application",
        debugSettings: {
          OTHER_CFLAGS: [
            "-ivfsoverlay",
            "/old/checkouts/App/ios/Pods/React-Core-prebuilt/React-VFS.yaml",
          ],
        },
      }],
    });

    const plan = await buildPlan({
      mainProject,
      context: CTX,
      podsRoot,
      sourcesByTargetId: { T_APP: [] },
    });

    expect(plan.targets[0]!.settings.OTHER_CFLAGS).toEqual(["-ivfsoverlay", vfsPath]);
  });
});
