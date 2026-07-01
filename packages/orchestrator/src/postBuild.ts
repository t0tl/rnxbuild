import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bundleApp } from "@rnxbuild/app-bundler";
import type { BuildPlan, BuildPlanTarget } from "@rnxbuild/build-planner";
import type { SettingValue } from "@rnxbuild/build-settings";
import { createLinker, type Linker } from "@rnxbuild/linker";
import type { TargetBuildResult } from "./types.js";

const APP_PRODUCT_TYPE = "com.apple.product-type.application";
const STATIC_LIBRARY_PRODUCT_TYPE = "com.apple.product-type.library.static";

export interface PostBuildInput {
  plan: BuildPlan;
  perTargetResults: Map<string, TargetBuildResult>;
  buildRoot: string;
  clangPath: string;
  sdkPath?: string;
  /** Injectable for tests. */
  _linker?: Linker;
}

export interface PostBuildResult {
  appPath: string;
  ok: boolean;
  failureReason?: string;
}

export async function postBuild(input: PostBuildInput): Promise<PostBuildResult | null> {
  const appTarget = input.plan.targets.find((target) => target.productType === APP_PRODUCT_TYPE);
  if (!appTarget) return null;

  const objectFiles = [...input.perTargetResults.values()].flatMap((result) => result.objectFiles);
  if (objectFiles.length === 0) {
    return { appPath: "", ok: false, failureReason: "no object files to link" };
  }

  const sdkPath = input.sdkPath ?? scalar(appTarget.settings.SDKROOT);
  if (!sdkPath) {
    return { appPath: "", ok: false, failureReason: "no SDK path available for link" };
  }

  const binaryPath = join(input.buildRoot, appTarget.name, appTarget.productModuleName);
  await mkdir(dirname(binaryPath), { recursive: true });

  const linker = input._linker ?? createLinker({ clangPath: input.clangPath });
  const { frameworks, weakFrameworks } = extractFrameworks(appTarget);
  const inPlanStaticLibraries = staticLibraryNames(input.plan.targets, appTarget);
  const linkResult = await linker.link({
    settings: {
      ...appTarget.settings,
      OTHER_LDFLAGS: withoutInPlanStaticLibraryFlags(
        appTarget.settings.OTHER_LDFLAGS,
        inPlanStaticLibraries,
      ),
    },
    context: input.plan.context,
    productType: appTarget.productType,
    productModuleName: appTarget.productModuleName,
    objectFiles,
    outputPath: binaryPath,
    sdkPath,
    staticLibraries: [],
    frameworks,
    weakFrameworks,
    swiftModulesToEmbed: [...input.perTargetResults.values()]
      .map((result) => result.swiftModule)
      .filter((path): path is string => Boolean(path)),
  });

  if (!linkResult.ok) {
    return {
      appPath: "",
      ok: false,
      failureReason: `link failed:\n${linkResult.stderr.slice(0, 2048)}`,
    };
  }

  const appPath = join(input.buildRoot, `${appTarget.productModuleName}.app`);
  const bundleResult = await bundleApp({
    outputAppPath: appPath,
    mainBinaryPath: linkResult.outputPath,
    settings: appTarget.settings,
    context: input.plan.context,
    productModuleName: appTarget.productModuleName,
    sdkPath,
    resources: appTarget.resources,
  });

  return { appPath: bundleResult.appPath, ok: bundleResult.ok };
}

function staticLibraryNames(targets: BuildPlanTarget[], appTarget: BuildPlanTarget): Set<string> {
  return new Set(targets
    .filter((target) => target.id !== appTarget.id && target.productType === STATIC_LIBRARY_PRODUCT_TYPE)
    .map((target) => target.productModuleName));
}

function withoutInPlanStaticLibraryFlags(
  flagsValue: SettingValue | undefined,
  staticLibraryNames: Set<string>,
): string[] {
  const flags = asArray(flagsValue);
  const filtered: string[] = [];

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    const unquotedFlag = stripQuotes(flag);
    if (unquotedFlag.startsWith("-l") && staticLibraryNames.has(unquotedFlag.slice(2))) {
      continue;
    }
    if (unquotedFlag === "-l" && i + 1 < flags.length) {
      const libraryName = stripQuotes(flags[i + 1]!);
      if (staticLibraryNames.has(libraryName)) {
        i++;
        continue;
      }
    }
    filtered.push(flag);
  }

  return filtered;
}

function extractFrameworks(target: BuildPlanTarget): { frameworks: string[]; weakFrameworks: string[] } {
  const frameworks: string[] = [];
  const weakFrameworks: string[] = [];
  const flags = asArray(target.settings.OTHER_LDFLAGS);

  for (let i = 0; i < flags.length; i++) {
    const flag = stripQuotes(flags[i]!);
    if (flag === "-framework" && i + 1 < flags.length) {
      frameworks.push(stripQuotes(flags[++i]!));
    } else if (flag === "-weak_framework" && i + 1 < flags.length) {
      weakFrameworks.push(stripQuotes(flags[++i]!));
    }
  }

  return { frameworks, weakFrameworks };
}

function scalar(v: SettingValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(" ") : v;
}

function asArray(v: SettingValue | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
