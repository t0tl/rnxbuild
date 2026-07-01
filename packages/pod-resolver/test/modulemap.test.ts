import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteModulemapPaths } from "../src/modulemap.js";

describe("rewriteModulemapPaths", () => {
  let podsRoot: string;
  let tmpRoot: string;

  beforeAll(async () => {
    // Build a tiny fake CocoaPods tree for the tests
    tmpRoot = await mkdtemp(join(tmpdir(), "rnxb-pod-paths-"));
    podsRoot = join(tmpRoot, "Pods");
    await mkdir(join(podsRoot, "Target Support Files", "Foo"), { recursive: true });
    await writeFile(join(podsRoot, "Target Support Files", "Foo", "Foo.modulemap"), "module Foo {}");
    await mkdir(join(podsRoot, "Target Support Files", "Bar"), { recursive: true });
    await writeFile(join(podsRoot, "Target Support Files", "Bar", "Bar.modulemap"), "module Bar {}");
    // Note: NO Target Support Files entry for "Baz" — tests the "leave original" fallback
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("rewrites a missing -fmodule-map-file path to its on-disk Target Support Files counterpart (array setting)", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: [
        "-Xcc",
        "-fmodule-map-file=/nonexistent/Foo/Foo.modulemap",
      ],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "-Xcc",
      `-fmodule-map-file=${podsRoot}/Target Support Files/Foo/Foo.modulemap`,
    ]);
  });

  it("rewrites multiple modulemap references independently", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: [
        "-Xcc", "-fmodule-map-file=/missing/Foo/Foo.modulemap",
        "-Xcc", "-fmodule-map-file=/missing/Bar/Bar.modulemap",
      ],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "-Xcc", `-fmodule-map-file=${podsRoot}/Target Support Files/Foo/Foo.modulemap`,
      "-Xcc", `-fmodule-map-file=${podsRoot}/Target Support Files/Bar/Bar.modulemap`,
    ]);
  });

  it("leaves the path unchanged when the original exists on disk", async () => {
    const existingPath = `${podsRoot}/Target Support Files/Foo/Foo.modulemap`;
    const result = await rewriteModulemapPaths({
      OTHER_CFLAGS: [`-fmodule-map-file=${existingPath}`],
    }, { podsRoot });
    expect(result.OTHER_CFLAGS).toEqual([`-fmodule-map-file=${existingPath}`]);
  });

  it("leaves the path unchanged when neither the original NOR the rewrite target exists (informative-error fallback)", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-fmodule-map-file=/nonexistent/Baz/Baz.modulemap"],
    }, { podsRoot });
    // Baz has no Target Support Files entry — leave original so the error message keeps pointing somewhere
    expect(result.OTHER_SWIFT_FLAGS).toEqual(["-fmodule-map-file=/nonexistent/Baz/Baz.modulemap"]);
  });

  it("scans BOTH string-valued and array-valued settings", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file=/missing/Foo/Foo.modulemap"],
      OTHER_CFLAGS: "-fmodule-map-file=/missing/Bar/Bar.modulemap",  // scalar
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "-Xcc",
      `-fmodule-map-file=${podsRoot}/Target Support Files/Foo/Foo.modulemap`,
    ]);
    expect(result.OTHER_CFLAGS).toBe(
      `-fmodule-map-file=${podsRoot}/Target Support Files/Bar/Bar.modulemap`,
    );
  });

  it("ignores settings without -fmodule-map-file (no-op)", async () => {
    const result = await rewriteModulemapPaths({
      SWIFT_VERSION: "5.0",
      OTHER_SWIFT_FLAGS: ["-D", "FOO", "-Wno-error"],
    }, { podsRoot });
    expect(result.SWIFT_VERSION).toBe("5.0");
    expect(result.OTHER_SWIFT_FLAGS).toEqual(["-D", "FOO", "-Wno-error"]);
  });

  it("does NOT mutate the input settings dict (purity)", async () => {
    const input = {
      OTHER_SWIFT_FLAGS: ["-fmodule-map-file=/missing/Foo/Foo.modulemap"],
    };
    const result = await rewriteModulemapPaths(input, { podsRoot });
    expect(input.OTHER_SWIFT_FLAGS).toEqual(["-fmodule-map-file=/missing/Foo/Foo.modulemap"]);
    expect(result.OTHER_SWIFT_FLAGS).not.toBe(input.OTHER_SWIFT_FLAGS);
  });

  it("handles a token that has both -Xcc prefix and -fmodule-map-file= (one token, embedded prefix)", async () => {
    // Sometimes a single token combines the -Xcc prefix and the flag, e.g.
    // "-Xcc-fmodule-map-file=...". Unusual but theoretically possible. The
    // rewriter should still find and rewrite the path portion.
    // Skip this if your tokenizer never produces such shapes; the cocoapods
    // xcconfigs we see always have separate -Xcc and -fmodule-map-file=...
    // tokens. The implementation should be robust to BOTH shapes.
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file=/missing/Foo/Foo.modulemap"],
    }, { podsRoot });
    const flag = result.OTHER_SWIFT_FLAGS as string[];
    expect(flag[1]).toContain("Target Support Files/Foo/Foo.modulemap");
  });

  it("preserves token order within an array", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: [
        "$(inherited)",
        "-D", "COCOAPODS",
        "-Xcc", "-fmodule-map-file=/missing/Foo/Foo.modulemap",
        "-Xcc", "-fmodule-map-file=/missing/Bar/Bar.modulemap",
      ],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "$(inherited)",
      "-D", "COCOAPODS",
      "-Xcc", `-fmodule-map-file=${podsRoot}/Target Support Files/Foo/Foo.modulemap`,
      "-Xcc", `-fmodule-map-file=${podsRoot}/Target Support Files/Bar/Bar.modulemap`,
    ]);
  });
});

describe("rewriteModulemapPaths — malformed token drop (Wall G1)", () => {
  let podsRoot: string;
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "rnxb-pod-paths-wallg1-"));
    podsRoot = join(tmpRoot, "Pods");
    await mkdir(join(podsRoot, "Target Support Files", "Foo"), { recursive: true });
    await writeFile(join(podsRoot, "Target Support Files", "Foo", "Foo.modulemap"), "module Foo {}");
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("drops a -fmodule-map-file= token whose path ends in / (empty filename)", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file=/some/path/ios/"],
    }, { podsRoot });
    // BOTH the -fmodule-map-file= token AND the preceding -Xcc are dropped
    expect(result.OTHER_SWIFT_FLAGS).toEqual([]);
  });

  it("drops a -fmodule-map-file= token with an empty path", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file="],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([]);
  });

  it("drops a -fmodule-map-file= token whose path doesn't end in .modulemap", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file=/some/path/notmm.txt"],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([]);
  });

  it("drops only the malformed token within a longer argv (preserves other tokens)", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: [
        "-D", "COCOAPODS",
        "-Xcc", "-fmodule-map-file=/some/path/ios/",
        "-Xcc", "-Wno-incomplete-umbrella",
      ],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "-D", "COCOAPODS",
      "-Xcc", "-Wno-incomplete-umbrella",
    ]);
  });

  it("drops only the malformed -fmodule-map-file= when there is NO preceding -Xcc (defensive)", async () => {
    const result = await rewriteModulemapPaths({
      OTHER_CFLAGS: ["-fmodule-map-file=/some/path/ios/"],
    }, { podsRoot });
    expect(result.OTHER_CFLAGS).toEqual([]);
  });

  it("preserves a well-formed -fmodule-map-file= that points at an existing .modulemap", async () => {
    const existingPath = `${podsRoot}/Target Support Files/Foo/Foo.modulemap`;
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", `-fmodule-map-file=${existingPath}`],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "-Xcc", `-fmodule-map-file=${existingPath}`,
    ]);
  });

  it("preserves a -fmodule-map-file= path that doesn't exist but IS well-formed (informative-error fallback unchanged)", async () => {
    // .modulemap suffix; no rewrite candidate exists; leave the token in place
    // (consistent with the existing 'leaves the path unchanged when neither the
    // original NOR the rewrite target exists' behavior — that's the
    // informative-error path, NOT a drop)
    const result = await rewriteModulemapPaths({
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file=/missing/Baz/Baz.modulemap"],
    }, { podsRoot });
    expect(result.OTHER_SWIFT_FLAGS).toEqual([
      "-Xcc", "-fmodule-map-file=/missing/Baz/Baz.modulemap",
    ]);
  });

  it("does NOT mutate input.settings", async () => {
    const input = {
      OTHER_SWIFT_FLAGS: ["-Xcc", "-fmodule-map-file=/some/ios/"],
    };
    await rewriteModulemapPaths(input, { podsRoot });
    expect(input.OTHER_SWIFT_FLAGS).toEqual(["-Xcc", "-fmodule-map-file=/some/ios/"]);
  });
});
