import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BuildPlanTarget } from "@rnxbuild/build-planner";
import type { BuildContext } from "@rnxbuild/build-settings";
import type { SwiftCompiler } from "@rnxbuild/swift-compiler";
import type { ClangCompiler } from "@rnxbuild/clang-compiler";
import type { TargetBuildResult } from "./types.js";

export interface BuildOneInput {
  target: BuildPlanTarget;
  context: BuildContext;
  buildRoot: string;
  /** Results of already-built deps (keyed by target.id). Used to thread .swiftmodule paths. */
  depResults: Map<string, TargetBuildResult>;
  swiftCompiler: SwiftCompiler;
  clangCompiler: ClangCompiler;
}

/**
 * Per-target dispatch: Swift first (with -emit-objc-header) → Obj-C/C/C++
 * second (with <Mod>-Swift.h on the include path). Pure orchestration —
 * compiler invocation is delegated; this file only decides shape + flow.
 */
export async function buildOneTarget(input: BuildOneInput): Promise<TargetBuildResult> {
  const start = process.hrtime.bigint();
  const targetDir = join(input.buildRoot, input.target.name);
  const swiftmoduleDir = join(targetDir, "swiftmodule");
  const headersDir = join(targetDir, "headers");
  const objDir = join(targetDir, "obj");
  await mkdir(swiftmoduleDir, { recursive: true });
  await mkdir(headersDir, { recursive: true });
  await mkdir(objDir, { recursive: true });

  const objectFiles: string[] = [];
  let swiftModule: string | undefined;
  let swiftBridgeHeader: string | undefined;
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  const depSwiftModulePaths = [...input.depResults.values()]
    .map((r) => r.swiftModule)
    .filter((p): p is string => Boolean(p));
  const depSwiftModuleSearchPaths = depSwiftModulePaths.map(swiftModuleSearchPath);
  const depSwiftBridgeHeaderSearchPaths = [...input.depResults.values()]
    .map((r) => r.swiftBridgeHeader)
    .filter((p): p is string => Boolean(p))
    .map(dirname);

  // Stage 1: Swift compile
  if (input.target.sources.swift.length > 0) {
    const swiftResult = await input.swiftCompiler.compile({
      settings: input.target.settings,
      context: input.context,
      sources: input.target.sources.swift,
      outputDir: swiftmoduleDir,
      moduleName: input.target.productModuleName,
      emitObjCHeader: true,
      objCHeaderOutputDir: headersDir,
      swiftModuleSearchPaths: depSwiftModuleSearchPaths,
      extraHeaderSearchPaths: depSwiftBridgeHeaderSearchPaths,
    });
    stdoutParts.push(swiftResult.stdout);
    stderrParts.push(swiftResult.stderr);
    if (!swiftResult.ok) {
      return failResult(start, swiftResult.objectFiles, stdoutParts, stderrParts);
    }
    objectFiles.push(...swiftResult.objectFiles);
    swiftModule = swiftResult.moduleFilePath;
    swiftBridgeHeader = swiftResult.bridgeHeaderPath;
  }

  // Stage 2: Obj-C / C / C++ compile
  const clangSources = [
    ...input.target.sources.objc,
    ...input.target.sources.objcpp,
    ...input.target.sources.c,
    ...input.target.sources.cpp,
  ];
  if (clangSources.length > 0) {
    const extraIncludes = [headersDir, ...depSwiftBridgeHeaderSearchPaths];
    const clangResult = await input.clangCompiler.compile({
      settings: input.target.settings,
      context: input.context,
      sources: clangSources,
      outputDir: objDir,
      extraIncludes,
    });
    stdoutParts.push(clangResult.stdout);
    stderrParts.push(clangResult.stderr);
    if (!clangResult.ok) {
      return failResult(
        start,
        [...objectFiles, ...clangResult.objectFiles],
        stdoutParts,
        stderrParts,
        swiftModule,
        swiftBridgeHeader,
      );
    }
    objectFiles.push(...clangResult.objectFiles);
  }

  return {
    ok: true,
    objectFiles,
    swiftModule,
    swiftBridgeHeader,
    durationMs: Number(process.hrtime.bigint() - start) / 1_000_000,
    stdout: stdoutParts.join("\n"),
    stderr: stderrParts.join("\n"),
  };
}

function swiftModuleSearchPath(modulePath: string): string {
  return modulePath.endsWith(".swiftmodule") ? dirname(modulePath) : modulePath;
}

function failResult(
  start: bigint,
  objectFiles: string[],
  stdoutParts: string[],
  stderrParts: string[],
  swiftModule?: string,
  swiftBridgeHeader?: string,
): TargetBuildResult {
  return {
    ok: false,
    objectFiles,
    swiftModule,
    swiftBridgeHeader,
    durationMs: Number(process.hrtime.bigint() - start) / 1_000_000,
    stdout: stdoutParts.join("\n"),
    stderr: stderrParts.join("\n"),
  };
}
