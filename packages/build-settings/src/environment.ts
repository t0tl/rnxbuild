import type { BuildContext } from "./conditions.js";
import type { SettingsDict } from "./resolve.js";

/**
 * Compute the Xcode-built-in environment variables that CocoaPods (and other
 * xcconfig consumers) depend on. These would normally be set per-target by
 * Xcode itself; for a Linux-based build driving SwiftPM, we synthesize them.
 *
 * For paths that don't have a real on-disk equivalent in our SwiftPM-driven
 * build (BUILT_PRODUCTS_DIR, CONFIGURATION_BUILD_DIR), we pick a coherent
 * placeholder so substitution produces well-formed strings. The compiler
 * will skip non-existent search paths with at most a warning.
 *
 * The most important seeded vars are SRCROOT and PROJECT_DIR — these resolve
 * `$(SRCROOT)/Pods` in CocoaPods xcconfigs to a REAL on-disk path so headers
 * actually resolve.
 */
export interface BuildXcodeEnvironmentInput {
  /** Absolute path to the .xcodeproj's parent dir (becomes SRCROOT). */
  projectDir: string;
  /** Build context for CONFIGURATION + EFFECTIVE_PLATFORM_NAME. */
  context: BuildContext;
  /** The target's name (becomes TARGET_NAME). */
  targetName: string;
  /** Optional synthetic build dir; defaults to <projectDir>/build. */
  buildDir?: string;
  /** Optional absolute path to the SDK root. When set, becomes SDKROOT; otherwise SDKROOT = platform name (bare). */
  sdkPath?: string;
}

export function buildXcodeEnvironment(input: BuildXcodeEnvironmentInput): SettingsDict {
  const buildDir = input.buildDir ?? `${input.projectDir}/build`;
  const platform = platformName(input.context.sdk);
  const effectivePlatform = `-${platform}`; // EFFECTIVE_PLATFORM_NAME is "-iphoneos" etc.
  return {
    SRCROOT: input.projectDir,
    PROJECT_DIR: input.projectDir,
    PROJECT_NAME: pathBasename(input.projectDir),
    CONFIGURATION: input.context.config,
    EFFECTIVE_PLATFORM_NAME: effectivePlatform,
    PLATFORM_NAME: platform,
    SDKROOT: input.sdkPath ?? platform,
    ARCHS: input.context.arch,
    CURRENT_ARCH: input.context.arch,
    TARGET_NAME: input.targetName,
    PRODUCT_NAME: input.targetName,
    BUILD_DIR: buildDir,
    BUILT_PRODUCTS_DIR: `${buildDir}/${input.context.config}${effectivePlatform}`,
    CONFIGURATION_BUILD_DIR: `${buildDir}/${input.context.config}${effectivePlatform}`,
    TARGET_BUILD_DIR: `${buildDir}/${input.context.config}${effectivePlatform}`,
    TOOLCHAIN_DIR: "/usr", // placeholder; real Xcode points at swift toolchain
    DEVELOPER_DIR: "/usr/share/xcode", // placeholder
  };
}

function platformName(sdk: string): string {
  // sdk like "iphoneos17.0" → "iphoneos"; "iphonesimulator17.0" → "iphonesimulator"
  const m = /^(iphoneos|iphonesimulator|macosx|appletvos|appletvsimulator|watchos|watchsimulator|xros|xrsimulator)/.exec(
    sdk,
  );
  return m ? m[1]! : sdk;
}

function pathBasename(p: string): string {
  // Tiny inline impl so this file stays node-import-free; same as path.basename for posix paths
  const lastSlash = p.lastIndexOf("/");
  return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}
