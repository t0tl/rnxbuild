import { describe, expect, it } from "vitest";
import { createClangCompiler } from "../src/compiler.js";
import type { BuildContext } from "@rnxbuild/build-settings";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("createClangCompiler.compile", () => {
  it("invokes clang ONCE per source file, with the per-source argv shape", async () => {
    const calls: { binary: string; args: string[] }[] = [];
    const compiler = createClangCompiler({
      clangPath: "/path/to/clang",
      run: (binary, args) => {
        calls.push({ binary, args });
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });

    const outDir = await mkdtemp(join(tmpdir(), "rnxb-clangc-"));
    const srcA = join(outDir, "a.m");
    const srcB = join(outDir, "b.mm");
    await writeFile(srcA, "// noop");
    await writeFile(srcB, "// noop");

    const result = await compiler.compile({
      settings: {},
      context: CTX,
      sources: [srcA, srcB],
      outputDir: outDir,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.binary).toBe("/path/to/clang");
    expect(calls[0]!.args).toContain(srcA);
    expect(calls[1]!.args).toContain(srcB);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("returns ok=false on first non-zero exit", async () => {
    const compiler = createClangCompiler({
      clangPath: "/clang",
      run: (_binary, args) => {
        const isSecond = args.some((a) => a.endsWith("b.m"));
        if (isSecond) return Promise.resolve({ stdout: "", stderr: "boom", exitCode: 1 });
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    const outDir = await mkdtemp(join(tmpdir(), "rnxb-clangc-fail-"));
    const srcA = join(outDir, "a.m");
    const srcB = join(outDir, "b.m");
    await writeFile(srcA, "// noop");
    await writeFile(srcB, "// noop");

    const result = await compiler.compile({
      settings: {},
      context: CTX,
      sources: [srcA, srcB],
      outputDir: outDir,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("boom");
  });

  it("collects expected objectFiles paths (one .o per source basename)", async () => {
    const compiler = createClangCompiler({
      clangPath: "/clang",
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const outDir = await mkdtemp(join(tmpdir(), "rnxb-clangc-out-"));
    const srcA = join(outDir, "alpha.m");
    const srcB = join(outDir, "beta.cpp");
    await writeFile(srcA, "// noop");
    await writeFile(srcB, "// noop");

    const result = await compiler.compile({
      settings: {},
      context: CTX,
      sources: [srcA, srcB],
      outputDir: outDir,
    });

    expect(result.objectFiles).toEqual([
      join(outDir, "alpha.o"),
      join(outDir, "beta.o"),
    ]);
  });

  it("captures argv passed to clang in the result (for debugging)", async () => {
    const compiler = createClangCompiler({
      clangPath: "/clang",
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const outDir = await mkdtemp(join(tmpdir(), "rnxb-clangc-argv-"));
    const srcA = join(outDir, "a.m");
    await writeFile(srcA, "// noop");

    const result = await compiler.compile({
      settings: { HEADER_SEARCH_PATHS: ["/h1"] },
      context: CTX,
      sources: [srcA],
      outputDir: outDir,
    });

    expect(result.argv).toContain("-I");
    expect(result.argv).toContain("/h1");
    expect(result.argv).toContain(srcA);
  });
});
