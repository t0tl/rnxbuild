import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinker } from "../src/linker.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };
const SDK = "/abs/iPhoneOS.sdk";

describe("createLinker.link", () => {
  it("invokes clang once with the linker argv", async () => {
    const calls: { binary: string; args: string[] }[] = [];
    const linker = createLinker({
      clangPath: "/path/to/clang",
      run: (binary, args) => {
        calls.push({ binary, args });
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });

    const outDir = await mkdtemp(join(tmpdir(), "rnxb-linker-"));
    const result = await linker.link(baseInput({ outputPath: join(outDir, "App") }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.binary).toBe("/path/to/clang");
    expect(calls[0]!.args).toContain("-isysroot");
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("writes the object files to a filelist and passes -filelist <path>", async () => {
    let observedArgs: string[] = [];
    const linker = createLinker({
      clangPath: "/clang",
      run: (_binary, args) => {
        observedArgs = args;
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });

    await linker.link(baseInput({ objectFiles: ["/o/a.o", "/o/b.o", "/o/c.o"] }));

    const flagIdx = observedArgs.indexOf("-filelist");
    expect(flagIdx).toBeGreaterThan(-1);
    const filelistPath = observedArgs[flagIdx + 1]!;
    const content = await readFile(filelistPath, "utf8");
    expect(content).toBe("/o/a.o\n/o/b.o\n/o/c.o\n");
  });

  it("returns ok=false on non-zero exit", async () => {
    const linker = createLinker({
      clangPath: "/clang",
      run: () => Promise.resolve({ stdout: "", stderr: "ld: undefined symbol", exitCode: 1 }),
    });

    const result = await linker.link(baseInput());

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("undefined symbol");
  });

  it("populates LinkResult.outputPath from input", async () => {
    const linker = createLinker({
      clangPath: "/clang",
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const outDir = await mkdtemp(join(tmpdir(), "rnxb-linker-out-"));
    const out = join(outDir, "App");

    const result = await linker.link(baseInput({ outputPath: out }));

    expect(result.outputPath).toBe(out);
  });

  it("captures argv in LinkResult for debugging", async () => {
    const linker = createLinker({
      clangPath: "/clang",
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    const result = await linker.link(baseInput());

    expect(result.argv).toContain("-isysroot");
    expect(result.argv).toContain(SDK);
  });

  it("can force ld64.lld selection through clang", async () => {
    const linker = createLinker({
      clangPath: "/clang",
      useLLD: true,
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    const result = await linker.link(baseInput());

    expect(result.argv[0]).toBe("-fuse-ld=lld");
  });

  it("points clang at an artifactbundle ld64.lld when the SDK path has one", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-linker-artifactbundle-"));
    const artifactbundleRoot = join(root, "darwin.artifactbundle");
    const toolsetBin = join(artifactbundleRoot, "toolset", "bin");
    await mkdir(toolsetBin, { recursive: true });
    await writeFile(join(toolsetBin, "ld64.lld"), "");

    const sdkPath = join(
      artifactbundleRoot,
      "Developer",
      "Platforms",
      "iPhoneOS.platform",
      "Developer",
      "SDKs",
      "iPhoneOS.sdk",
    );
    const linker = createLinker({
      clangPath: "/clang",
      useLLD: true,
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    const result = await linker.link(baseInput({ sdkPath }));

    expect(result.argv.slice(0, 3)).toEqual(["-fuse-ld=lld", "-B", toolsetBin]);
  });

  it("adds artifactbundle Swift and compiler runtime paths for Linux-hosted Darwin links", async () => {
    const root = await mkdtemp(join(tmpdir(), "rnxb-linker-runtime-"));
    const artifactbundleRoot = join(root, "darwin.artifactbundle");
    const toolchainRoot = join(
      artifactbundleRoot,
      "Developer",
      "Toolchains",
      "XcodeDefault.xctoolchain",
    );
    const swiftLibDir = join(toolchainRoot, "usr", "lib", "swift", "iphoneos");
    const clangRuntimeDir = join(toolchainRoot, "usr", "lib", "clang", "21", "lib", "darwin");
    const sdkPath = join(
      artifactbundleRoot,
      "Developer",
      "Platforms",
      "iPhoneOS.platform",
      "Developer",
      "SDKs",
      "iPhoneOS.sdk",
    );
    await mkdir(swiftLibDir, { recursive: true });
    await mkdir(clangRuntimeDir, { recursive: true });
    await mkdir(join(sdkPath, "System", "Library", "Frameworks"), { recursive: true });
    await mkdir(join(sdkPath, "System", "Library", "SubFrameworks"), { recursive: true });
    const clangRuntime = join(clangRuntimeDir, "libclang_rt.ios.a");
    await writeFile(clangRuntime, "");

    const linker = createLinker({
      clangPath: "/clang",
      useLLD: true,
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    const result = await linker.link(baseInput({ sdkPath }));

    expect(result.argv).toContain(swiftLibDir);
    expect(result.argv).toContain(join(sdkPath, "System", "Library", "Frameworks"));
    expect(result.argv).toContain(join(sdkPath, "System", "Library", "SubFrameworks"));
    expect(result.argv.indexOf(clangRuntime)).toBeGreaterThan(result.argv.indexOf("-filelist"));
  });

  it("allows callers to pass an explicit Darwin linker search path", async () => {
    const linker = createLinker({
      clangPath: "/clang",
      useLLD: true,
      darwinLinkerSearchPath: "/toolset/bin",
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    const result = await linker.link(baseInput());

    expect(result.argv.slice(0, 3)).toEqual(["-fuse-ld=lld", "-B", "/toolset/bin"]);
  });

  it("can preserve clang's default linker selection", async () => {
    const linker = createLinker({
      clangPath: "/clang",
      useLLD: false,
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    const result = await linker.link(baseInput());

    expect(result.argv).not.toContain("-fuse-ld=lld");
  });
});

function baseInput(
  overrides: Partial<Parameters<ReturnType<typeof createLinker>["link"]>[0]> = {},
): Parameters<ReturnType<typeof createLinker>["link"]>[0] {
  return {
    settings: {},
    context: CTX,
    productType: "com.apple.product-type.application",
    productModuleName: "App",
    objectFiles: ["/o/a.o"],
    outputPath: "/out/App",
    sdkPath: SDK,
    ...overrides,
  };
}
