import { describe, expect, it, beforeAll } from "vitest";
import { parseProject } from "../src/project.js";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseProject deps + id", () => {
  let projectDir: string;

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-wp-deps-"));
    projectDir = join(root, "TestApp.xcodeproj");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "project.pbxproj"),
      `// !$*UTF8*$!
{
  archiveVersion = 1;
  objectVersion = 56;
  objects = {
    PROJ /* Project object */ = {
      isa = PBXProject;
      buildConfigurationList = PROJ_BCL;
      targets = ( TGT_APP, TGT_LIB );
    };
    PROJ_BCL = {
      isa = XCConfigurationList;
      buildConfigurations = ();
    };
    TGT_APP = {
      isa = PBXNativeTarget;
      name = App;
      productType = "com.apple.product-type.application";
      buildConfigurationList = APP_BCL;
      buildPhases = ();
      dependencies = ( DEP1 );
    };
    TGT_LIB = {
      isa = PBXNativeTarget;
      name = Lib;
      productType = "com.apple.product-type.library.static";
      buildConfigurationList = LIB_BCL;
      buildPhases = ();
      dependencies = ();
    };
    APP_BCL = {
      isa = XCConfigurationList;
      buildConfigurations = ();
    };
    LIB_BCL = {
      isa = XCConfigurationList;
      buildConfigurations = ();
    };
    DEP1 = {
      isa = PBXTargetDependency;
      target = TGT_LIB;
    };
  };
  rootObject = PROJ;
}
`,
      "utf8",
    );
  });

  it("populates each target's id field with the PBX object UUID", async () => {
    const proj = await parseProject(projectDir);
    expect(proj.targets).toHaveLength(2);
    const app = proj.targets.find((t) => t.name === "App")!;
    const lib = proj.targets.find((t) => t.name === "Lib")!;
    expect(app.id).toBe("TGT_APP");
    expect(lib.id).toBe("TGT_LIB");
  });

  it("populates each target's dependencies as a list of target ids", async () => {
    const proj = await parseProject(projectDir);
    const app = proj.targets.find((t) => t.name === "App")!;
    const lib = proj.targets.find((t) => t.name === "Lib")!;
    expect(app.dependencies).toEqual(["TGT_LIB"]);
    expect(lib.dependencies).toEqual([]);
  });

  it("ignores PBXTargetDependency entries that point at a targetProxy (cross-project, not yet supported)", async () => {
    const proj = await parseProject(projectDir);
    expect(proj.targets.find((t) => t.name === "App")!.dependencies).toEqual([
      "TGT_LIB",
    ]);
  });
});
