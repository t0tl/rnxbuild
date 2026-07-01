import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseProject } from "../src/project.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectPath = resolve(here, "fixtures/HelloApp.xcodeproj");

describe("parseProject", () => {
  it("lists native targets", async () => {
    const p = await parseProject(projectPath);
    expect(p.targets.map((t) => t.name)).toEqual(["HelloApp"]);
    expect(p.targets[0]!.productType).toBe("com.apple.product-type.application");
  });

  it("exposes target build configurations", async () => {
    const p = await parseProject(projectPath);
    const target = p.targets[0]!;
    expect(target.configurations.map((c) => c.name).sort()).toEqual(["Debug", "Release"]);
  });

  it("exposes per-configuration build settings", async () => {
    const p = await parseProject(projectPath);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.PRODUCT_NAME).toBe("HelloApp");
    expect(debug.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).toBe("com.example.helloapp");
    expect(debug.buildSettings.SWIFT_VERSION).toBe("5.0");
  });

  it("exposes project-level build configurations", async () => {
    const p = await parseProject(projectPath);
    expect(p.projectConfigurations.map((c) => c.name).sort()).toEqual(["Debug", "Release"]);
    const debug = p.projectConfigurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.ALWAYS_SEARCH_USER_PATHS).toBe("NO");
  });
});

describe("normalizeBuildSettings — conditional tokenization for $(inherited)", () => {
  const inheritedFixture = resolve(here, "fixtures/InheritedScalar.xcodeproj");

  it("tokenizes a scalar string value that contains $(inherited)", async () => {
    const p = await parseProject(inheritedFixture);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.OTHER_SWIFT_FLAGS).toEqual([
      "$(inherited)",
      "-D",
      "EXPO_CONFIGURATION_DEBUG",
    ]);
  });

  it("tokenizes OTHER_LDFLAGS with $(inherited) into a proper array", async () => {
    const p = await parseProject(inheritedFixture);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.OTHER_LDFLAGS).toEqual([
      "$(inherited)",
      "-ObjC",
      "-framework",
      "UIKit",
    ]);
  });

  it("tokenizes HEADER_SEARCH_PATHS with $(inherited)", async () => {
    const p = await parseProject(inheritedFixture);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.HEADER_SEARCH_PATHS).toEqual([
      "$(inherited)",
      "/some/path",
    ]);
  });

  it("tokenizes known list-valued settings without $(inherited)", async () => {
    const p = await parseProject(inheritedFixture);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.LIBRARY_SEARCH_PATHS).toEqual(["/lib/one", "/lib/two"]);
  });

  it("preserves scalar settings WITHOUT $(inherited) as bare strings", async () => {
    const p = await parseProject(inheritedFixture);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.PRODUCT_NAME).toBe("HelloApp");
    expect(debug.buildSettings.GCC_PREPROCESSOR_DEFINITIONS).toBe("DEBUG=1");
  });

  it("preserves quoted multi-word scalar (e.g. copyright string) as bare scalar WITHOUT splitting", async () => {
    // Critical safety check: INFOPLIST_KEY_NSHumanReadableCopyright contains
    // spaces but no $(inherited). Tokenization would incorrectly split it into
    // ["Copyright", "(c)", "2024", "Acme", "Inc"]. The $(inherited)-conditional
    // guard prevents that.
    const p = await parseProject(inheritedFixture);
    const debug = p.targets[0]!.configurations.find((c) => c.name === "Debug")!;
    expect(debug.buildSettings.INFOPLIST_KEY_NSHumanReadableCopyright).toBe(
      "Copyright (c) 2024 Acme Inc",
    );
  });
});
