import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteRelocatedAbsolutePaths } from "../src/absolutePaths.js";

describe("rewriteRelocatedAbsolutePaths", () => {
  it("rebases missing stale ios/Pods paths to the current podsRoot", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-abs-paths-"));
    const podsRoot = join(root, "App", "ios", "Pods");
    const vfsPath = join(podsRoot, "React-Core-prebuilt", "React-VFS.yaml");
    await mkdir(join(podsRoot, "React-Core-prebuilt"), { recursive: true });
    await writeFile(vfsPath, "{}\n");

    try {
      const result = await rewriteRelocatedAbsolutePaths(
        {
          OTHER_CFLAGS: [
            "-ivfsoverlay",
            "/old/checkouts/App/ios/Pods/React-Core-prebuilt/React-VFS.yaml",
          ],
        },
        { podsRoot },
      );

      expect(result.OTHER_CFLAGS).toEqual(["-ivfsoverlay", vfsPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves prefixes and plugin specifiers around rebased paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-abs-paths-plugin-"));
    const projectRoot = join(root, "App");
    const podsRoot = join(projectRoot, "ios", "Pods");
    const modulemap = join(podsRoot, "Headers", "Public", "Foo", "Foo.modulemap");
    const macroTool = join(
      projectRoot,
      "node_modules",
      "@expo",
      "expo-modules-macros-plugin",
      "apple",
      "ExpoModulesMacros-tool",
    );
    await mkdir(join(podsRoot, "Headers", "Public", "Foo"), { recursive: true });
    await mkdir(join(projectRoot, "node_modules", "@expo", "expo-modules-macros-plugin", "apple"), {
      recursive: true,
    });
    await writeFile(modulemap, "module Foo {}\n");
    await writeFile(macroTool, "tool\n");

    try {
      const result = await rewriteRelocatedAbsolutePaths(
        {
          OTHER_SWIFT_FLAGS: [
            "-Xcc",
            "-fmodule-map-file=/old/checkouts/App/ios/Pods/Headers/Public/Foo/Foo.modulemap",
            "-Xfrontend",
            "/old/checkouts/App/node_modules/@expo/expo-modules-macros-plugin/apple/ExpoModulesMacros-tool#ExpoModulesMacros",
          ],
        },
        { podsRoot },
      );

      expect(result.OTHER_SWIFT_FLAGS).toEqual([
        "-Xcc",
        `-fmodule-map-file=${modulemap}`,
        "-Xfrontend",
        `${macroTool}#ExpoModulesMacros`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves existing and unrecognized missing absolute paths unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-abs-paths-keep-"));
    const podsRoot = join(root, "App", "ios", "Pods");
    const existing = join(root, "exists.txt");
    await mkdir(podsRoot, { recursive: true });
    await writeFile(existing, "ok\n");

    try {
      const result = await rewriteRelocatedAbsolutePaths(
        {
          A: existing,
          B: "/old/checkouts/App/SomewhereElse/file.txt",
        },
        { podsRoot },
      );

      expect(result.A).toBe(existing);
      expect(result.B).toBe("/old/checkouts/App/SomewhereElse/file.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not mutate the input settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-abs-paths-pure-"));
    const podsRoot = join(root, "App", "ios", "Pods");
    await mkdir(podsRoot, { recursive: true });
    const input = { OTHER_CFLAGS: ["/old/checkouts/App/ios/Pods/Missing.yaml"] };

    try {
      await rewriteRelocatedAbsolutePaths(input, { podsRoot });
      expect(input.OTHER_CFLAGS).toEqual(["/old/checkouts/App/ios/Pods/Missing.yaml"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
