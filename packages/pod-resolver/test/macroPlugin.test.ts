import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteMacroPluginPaths } from "../src/macroPlugin.js";

describe("rewriteMacroPluginPaths", () => {
  it("rewrites ExpoModulesMacros-tool to a host-built SwiftPM executable when present", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-macro-plugin-"));
    const appleDir = join(root, "@expo", "expo-modules-macros-plugin", "apple");
    const macTool = join(appleDir, "ExpoModulesMacros-tool");
    const linuxTool = join(
      appleDir,
      ".build",
      "x86_64-unknown-linux-gnu",
      "release",
      "ExpoModulesMacros-tool",
    );
    await mkdir(join(appleDir, ".build", "x86_64-unknown-linux-gnu", "release"), {
      recursive: true,
    });
    await writeFile(macTool, "mac");
    await writeFile(linuxTool, "linux");

    try {
      const result = await rewriteMacroPluginPaths(
        {
          OTHER_SWIFT_FLAGS: [
            "-Xfrontend",
            "-load-plugin-executable",
            "-Xfrontend",
            `${macTool}#ExpoModulesMacros`,
          ],
        },
        { hostTriple: "x86_64-unknown-linux-gnu" },
      );

      expect(result.OTHER_SWIFT_FLAGS).toEqual([
        "-Xfrontend",
        "-load-plugin-executable",
        "-Xfrontend",
        `${linuxTool}#ExpoModulesMacros`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the original token when no host-built executable exists", async () => {
    const token = "/pkg/apple/ExpoModulesMacros-tool#ExpoModulesMacros";
    const result = await rewriteMacroPluginPaths(
      { OTHER_SWIFT_FLAGS: [token] },
      { hostTriple: "x86_64-unknown-linux-gnu" },
    );
    expect(result.OTHER_SWIFT_FLAGS).toEqual([token]);
  });

  it("does not touch non-swift settings", async () => {
    const input = { FRAMEWORK_SEARCH_PATHS: ["/Frameworks"] };
    const result = await rewriteMacroPluginPaths(input);
    expect(result).toEqual(input);
    expect(result.FRAMEWORK_SEARCH_PATHS).not.toBe(input.FRAMEWORK_SEARCH_PATHS);
  });
});
