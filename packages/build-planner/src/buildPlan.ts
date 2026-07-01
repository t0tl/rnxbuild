import { dirname } from "node:path";
import { stat } from "node:fs/promises";
import type { XcodeProject, XcodeNativeTarget } from "@rnxbuild/workspace-parser";
import {
  loadXcconfigChain,
  resolveFileReferencePath,
  type ParsedXcconfig,
} from "@rnxbuild/workspace-parser";
import {
  buildXcodeEnvironment,
  resolveTargetSettings,
  type BuildContext,
  type SettingsDict,
} from "@rnxbuild/build-settings";
import {
  rewriteFrameworkSearchPaths,
  rewriteMacroPluginPaths,
  rewriteModulemapPaths,
  rewriteRelocatedAbsolutePaths,
} from "@rnxbuild/pod-resolver";
import type { BuildPlan, BuildPlanTarget } from "./types.js";
import { partitionSourcesByLang } from "./partition.js";
import { deriveDeps } from "./deps.js";

export interface BuildPlanInput {
  /** Main app project. */
  mainProject: XcodeProject;
  /** Optional synthetic Pods.xcodeproj. */
  podsProject?: XcodeProject;
  /** Build context (sdk / arch / config). */
  context: BuildContext;
  /**
   * EXTRA environment merged on top of the per-project synthesized env (which
   * always includes SRCROOT/PROJECT_DIR/PROJECT_NAME derived from THIS project's
   * .xcodeproj location). Use this to thread sdkPath, custom TOOLCHAIN_DIR,
   * or any user-overrides. `extraEnvironment` entries OVERRIDE per-project
   * values with the same key (so callers can e.g. swap the bare-platform-name
   * SDKROOT for an absolute SDK path).
   */
  extraEnvironment?: SettingsDict;
  /**
   * Absolute path to the iOS SDK root. When provided, OVERRIDES SDKROOT in
   * every input layer (env + projectSettings + targetSettings + configurationSettings)
   * so that downstream compilers see the absolute path instead of the bare
   * platform name (`iphoneos`) that production pbxprojs typically set.
   * Mirrors Xcode's behavior of resolving the bare SDK name to an absolute
   * path at compile time. Wins over `extraEnvironment.SDKROOT` when both set.
   */
  sdkPath?: string;
  /** Path to Pods/ directory; pod-resolver rewriters need it. */
  podsRoot: string;
  /**
   * Map of target.id → absolute source file paths.
   * Callers compute this via `targetSourceFiles()` per project; passing it in
   * keeps buildPlan pure-data-in (no project-path resolution required for tests).
   */
  sourcesByTargetId: Record<string, string[]>;
}

/**
 * PBX → BuildPlan. Walks main + optional pods project, loads each target's
 * xcconfig chain via its baseConfigurationReference, runs the build-settings
 * cascade, applies pod-resolver rewriters, partitions sources, derives deps.
 */
export async function buildPlan(input: BuildPlanInput): Promise<BuildPlan> {
  const allNativeTargets: { project: XcodeProject; target: XcodeNativeTarget }[] = [
    ...input.mainProject.targets.map((t) => ({ project: input.mainProject, target: t })),
    ...(input.podsProject?.targets ?? []).map((t) => ({ project: input.podsProject!, target: t })),
  ];

  const candidateTargets = allNativeTargets.map(({ target }) => ({
    id: target.id,
    name: target.name,
  }));

  const planTargets: BuildPlanTarget[] = [];

  for (const { project, target } of allNativeTargets) {
    const debugConfig = target.configurations.find((c) => c.name === input.context.config);
    if (!debugConfig) continue;
    const projDebug = project.projectConfigurations.find((c) => c.name === input.context.config);

    // Resolve the target's xcconfig chain (CocoaPods-injected settings live here).
    let xcconfigs: ParsedXcconfig[] = [];
    const xcconfigPath = resolveFileReferencePath(debugConfig.baseConfigurationReference, project);
    if (xcconfigPath) {
      try {
        xcconfigs = await loadXcconfigChain(xcconfigPath);
      } catch {
        // Missing or malformed xcconfig — fall back to empty chain.
        // The cascade still resolves the rest of the layers correctly.
        xcconfigs = [];
      }
    }

    // Synthesize SRCROOT/PROJECT_DIR/PROJECT_NAME from THIS target's owning
    // project dir — CocoaPods xcconfigs encode PODS_ROOT = ${SRCROOT}, so pod
    // targets need SRCROOT pointing at the Pods/ dir, not the main project.
    const perProjectEnv = buildXcodeEnvironment({
      projectDir: dirname(project.path),
      context: input.context,
      targetName: target.name,
    });
    const modulemapRel = await probeModulemapForTarget(input.podsRoot, target.name);
    if (modulemapRel) {
      perProjectEnv.MODULEMAP_FILE = modulemapRel;
    }
    const mergedEnv: SettingsDict = { ...perProjectEnv, ...(input.extraEnvironment ?? {}) };

    const settings: SettingsDict = resolveTargetSettings({
      xcconfigs,
      projectSettings: withSdkOverride(projDebug?.buildSettings ?? {}, input.sdkPath),
      targetSettings: withSdkOverride({}, input.sdkPath),
      configurationSettings: withSdkOverride(debugConfig.buildSettings, input.sdkPath),
      context: input.context,
      environment: input.sdkPath ? { ...mergedEnv, SDKROOT: input.sdkPath } : mergedEnv,
    });

    const afterModulemap = await rewriteModulemapPaths(settings, { podsRoot: input.podsRoot });
    const afterFrameworks = await rewriteFrameworkSearchPaths(afterModulemap, {
      podsRoot: input.podsRoot,
      context: input.context,
    });
    const afterAbsolutePaths = await rewriteRelocatedAbsolutePaths(afterFrameworks, {
      podsRoot: input.podsRoot,
    });
    const finalSettings = await rewriteMacroPluginPaths(afterAbsolutePaths);

    const sources = input.sourcesByTargetId[target.id] ?? [];
    const partitioned = partitionSourcesByLang(sources);

    const deps = deriveDeps({
      explicitDepIds: target.dependencies,
      settings: finalSettings,
      candidateTargets,
    });

    const productModuleName = scalar(finalSettings.PRODUCT_MODULE_NAME) ?? target.name;

    planTargets.push({
      id: target.id,
      name: target.name,
      productModuleName,
      productType: target.productType,
      sources: partitioned,
      settings: finalSettings,
      deps,
      resources: [],
    });
  }

  return { targets: planTargets, context: input.context, podsRoot: input.podsRoot };
}

function scalar(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(" ");
  return undefined;
}

/**
 * If `sdkPath` is set AND this cascade layer already defines SDKROOT, replace
 * it. Otherwise, return the layer unchanged. We deliberately do NOT inject
 * SDKROOT into layers that didn't have it — only existing values get overridden.
 */
function withSdkOverride(layer: SettingsDict, sdkPath: string | undefined): SettingsDict {
  if (!sdkPath) return layer;
  if (!("SDKROOT" in layer)) return layer;
  return { ...layer, SDKROOT: sdkPath };
}

/**
 * Probe the canonical CocoaPods modulemap location for this target. CocoaPods
 * generates one at `Pods/Target Support Files/<TargetName>/<TargetName>.modulemap`
 * for any pod that declares a module. Production CocoaPods sets MODULEMAP_FILE
 * per target via auto-generated build settings; we synthesize the same setting
 * when the file is present on disk.
 *
 * Returns the relative path (relative to SRCROOT for pod targets, which is
 * the Pods/ dir itself) when present; null otherwise.
 */
async function probeModulemapForTarget(
  podsRoot: string,
  targetName: string,
): Promise<string | null> {
  const rel = `Target Support Files/${targetName}/${targetName}.modulemap`;
  const abs = `${podsRoot}/${rel}`;
  try {
    await stat(abs);
    return rel;
  } catch {
    return null;
  }
}
