import type { SettingsDict, SettingValue, BuildContext } from "@rnxbuild/build-settings";

export interface SwiftcArgsInput {
  /** Fully-resolved build settings for this target × configuration. */
  settings: SettingsDict;
  /** The build context (sdk, arch, config). */
  context: BuildContext;
  /** Source files (absolute paths) to compile. */
  sources: string[];
  /** Output directory; .o and .swiftmodule land here. */
  outputDir: string;
  /** Module name; used for output filenames and -module-name. */
  moduleName: string;
  /** When true, emit a `<ModuleName>-Swift.h` header for Obj-C consumers. */
  emitObjCHeader?: boolean;
  /** Directory to emit `<ModuleName>-Swift.h` into. Required when emitObjCHeader=true. */
  objCHeaderOutputDir?: string;
  /** Extra `-I` paths for swiftc to search for upstream `.swiftmodule` dirs. */
  swiftModuleSearchPaths?: string[];
  /** Extra header search paths for Swift's Clang importer. */
  extraHeaderSearchPaths?: string[];
}

const DEFAULT_DEPLOYMENT_TARGET = "17.0";

/**
 * Pure: translate Xcode build settings + context into a swiftc argv.
 * Does NOT include `swift build` or `swiftc` as argv[0] — caller wraps that.
 */
export function buildSwiftcArgs(input: SwiftcArgsInput): string[] {
  const args: string[] = [];
  const s = input.settings;

  // --swift-sdk for cross-compile to iOS
  args.push("--swift-sdk", "arm64-apple-ios");

  // -target: derived from arch + deployment target
  const deploymentTarget = scalar(s.IPHONEOS_DEPLOYMENT_TARGET) ?? DEFAULT_DEPLOYMENT_TARGET;
  args.push("-target", `${input.context.arch}-apple-ios${deploymentTarget}`);

  // PRODUCT_MODULE_NAME from settings wins when present (so a caller threading
  // raw resolved settings through gets Xcode-correct behavior); input.moduleName
  // is the explicit override / fallback for callers that have already resolved
  // a module name out-of-band.
  const definesModule = scalar(s.DEFINES_MODULE) === "YES";
  const moduleName = scalar(s.PRODUCT_MODULE_NAME) ?? input.moduleName;

  // -swift-version: truncate to major (5.0 → 5)
  const swiftVersion = scalar(s.SWIFT_VERSION);
  if (swiftVersion !== undefined) {
    const major = swiftVersionMajor(swiftVersion, moduleName);
    args.push("-swift-version", major);
    if (needsBareSlashRegex(moduleName, major)) args.push("-enable-bare-slash-regex");
    const strictConcurrency = swiftStrictConcurrency(s.SWIFT_STRICT_CONCURRENCY);
    if (strictConcurrency) args.push(`-strict-concurrency=${strictConcurrency}`);
  }

  // Module emission.
  args.push("-module-name", moduleName);
  if (definesModule) {
    args.push("-emit-module");
    args.push("-emit-module-path", `${input.outputDir}/${moduleName}.swiftmodule`);
  }

  // Obj-C generated header for Swift→Obj-C interop in mixed-language targets
  if (input.emitObjCHeader) {
    if (!input.objCHeaderOutputDir) {
      throw new Error("objCHeaderOutputDir is required when emitObjCHeader is true");
    }
    args.push("-emit-objc-header");
    args.push("-emit-objc-header-path", `${input.objCHeaderOutputDir}/${moduleName}-Swift.h`);
  }

  // Upstream swiftmodule search paths from the orchestrator (per-target dep .swiftmodule dirs)
  if (input.swiftModuleSearchPaths) {
    for (const p of input.swiftModuleSearchPaths) args.push("-I", p);
  }

  // Optimization + compilation mode
  const opt = scalar(s.SWIFT_OPTIMIZATION_LEVEL);
  if (opt) args.push(opt);
  if (scalar(s.SWIFT_COMPILATION_MODE) === "wholemodule") args.push("-wmo");

  // Search paths
  for (const p of asArray(s.FRAMEWORK_SEARCH_PATHS)) args.push("-F", p);
  for (const p of asArray(s.SWIFT_INCLUDE_PATHS)) args.push("-I", p);
  // Each HEADER_SEARCH_PATHS entry needs its OWN -Xcc prefix on both the -I
  // flag and the path itself — swiftc's -Xcc forwards only the immediately-
  // following arg. Without the second -Xcc, the path lands as a positional
  // swiftc input ("unexpected input file"). Plan-3 Wall B fix.
  const headerSearchPaths = [
    ...asArray(s.HEADER_SEARCH_PATHS),
    ...(input.extraHeaderSearchPaths ?? []),
  ];
  for (const p of headerSearchPaths) args.push("-Xcc", "-I", "-Xcc", p);
  if (needsReactBridgeModulePreinclude(moduleName)) {
    args.push("-Xcc", "-include", "-Xcc", reactBridgeModuleHeader(headerSearchPaths));
  }

  // Preprocessor + flag passthrough
  for (const d of asArray(s.SWIFT_ACTIVE_COMPILATION_CONDITIONS)) args.push("-D", d);
  for (const d of asArray(s.GCC_PREPROCESSOR_DEFINITIONS)) args.push("-Xcc", `-D${d}`);
  for (const f of asArray(s.OTHER_SWIFT_FLAGS)) args.push(f);
  if (scalar(s.CLANG_ENABLE_MODULES) === "YES") args.push("-Xcc", "-fmodules");

  // Output
  args.push("-o", `${input.outputDir}/${moduleName}.o`);

  // Sources go at the end
  args.push(...input.sources);

  return args;
}

function scalar(v: SettingValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(" ") : v;
}

function asArray(v: SettingValue | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function swiftStrictConcurrency(v: SettingValue | undefined): string | undefined {
  const value = scalar(v)?.toLowerCase();
  switch (value) {
    case "minimal":
    case "targeted":
    case "complete":
      return value;
    default:
      return undefined;
  }
}

function needsReactBridgeModulePreinclude(moduleName: string): boolean {
  return moduleName === "ExpoModulesCore";
}

function reactBridgeModuleHeader(headerSearchPaths: string[]): string {
  const prebuiltPath = headerSearchPaths.find((p) => p.includes("React-Core-prebuilt"));
  if (prebuiltPath) return `${prebuiltPath}/React_Core/React/RCTBridgeModule.h`;

  return "React/RCTBridgeModule.h";
}

function swiftVersionMajor(swiftVersion: string, moduleName: string): string {
  const major = swiftVersion.split(".")[0]!;
  if (moduleName === "ExpoModulesCore" && major === "6") return "5";
  return major;
}

function needsBareSlashRegex(moduleName: string, swiftMajor: string): boolean {
  return moduleName === "ExpoModulesCore" && swiftMajor === "5";
}
