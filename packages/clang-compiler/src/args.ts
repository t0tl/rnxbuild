import { basename, isAbsolute, join } from "node:path";
import type { SettingsDict, SettingValue, BuildContext } from "@rnxbuild/build-settings";

export interface ClangArgsInput {
  /** Fully-resolved build settings for this target × configuration. */
  settings: SettingsDict;
  /** The build context (sdk, arch, config). */
  context: BuildContext;
  /** Source files (absolute paths) to compile. */
  sources: string[];
  /** Output directory; .o files land here. */
  outputDir: string;
  /** Extra -I paths beyond what's in settings.HEADER_SEARCH_PATHS. */
  extraIncludes?: string[];
}

const DEFAULT_DEPLOYMENT_TARGET = "17.0";

/**
 * Pure: translate Xcode build settings + context into a clang argv suitable
 * for compiling Obj-C / Obj-C++ / C / C++ sources into per-source `.o` files.
 *
 * Does NOT include `clang` or `clang++` as argv[0] — caller wraps that.
 * This implementation builds a multi-source argv; the driver (createClangCompiler)
 * may split it per-source in practice.
 */
export function buildClangArgs(input: ClangArgsInput): string[] {
  const args: string[] = [];
  const s = input.settings;

  // -target: derived from arch + deployment target
  const deploymentTarget = scalar(s.IPHONEOS_DEPLOYMENT_TARGET) ?? DEFAULT_DEPLOYMENT_TARGET;
  args.push("-target", `${input.context.arch}-apple-ios${deploymentTarget}`);

  // -isysroot from settings
  const sdkroot = scalar(s.SDKROOT);
  if (sdkroot !== undefined) {
    args.push("-isysroot", sdkroot);
  }

  // -arch
  args.push("-arch", input.context.arch);

  // Optimization level
  const opt = scalar(s.GCC_OPTIMIZATION_LEVEL);
  if (opt !== undefined && opt !== "") {
    args.push(`-O${opt}`);
  }

  // Language standards — per-source gating. The driver normally invokes
  // buildClangArgs once per source, so we can pick the right -std= based on
  // the source's extension. In multi-source degenerate calls, fall back to
  // emitting both (preserves the older test surface).
  const cStd = scalar(s.GCC_C_LANGUAGE_STANDARD);
  const cxxStd = scalar(s.CLANG_CXX_LANGUAGE_STANDARD);
  const langs = new Set(input.sources.map(sourceLanguage).filter((l) => l !== null));
  // When all sources are a single known language, emit ONLY that one.
  // When languages are mixed (or unknown), emit both that were requested.
  // When no source extension is recognized, emit neither.
  const onlyC = langs.size === 1 && langs.has("c");
  const onlyCpp = langs.size === 1 && langs.has("cpp");
  const allUnknown = input.sources.length > 0 && langs.size === 0;
  if (cStd && !allUnknown && (onlyC || !onlyCpp)) args.push(`-std=${cStd}`);
  if (cxxStd && !allUnknown && (onlyCpp || !onlyC)) args.push(`-std=${cxxStd}`);

  // Feature toggles
  if (scalar(s.CLANG_ENABLE_OBJC_ARC) === "YES") args.push("-fobjc-arc");
  if (scalar(s.CLANG_ENABLE_MODULES) === "YES") args.push("-fmodules");

  // Search paths
  const headerSearchPaths = asArray(s.HEADER_SEARCH_PATHS);
  for (const p of headerSearchPaths) args.push("-I", p);
  for (const p of asArray(s.FRAMEWORK_SEARCH_PATHS)) args.push("-F", p);
  for (const p of input.extraIncludes ?? []) args.push("-I", p);
  for (const p of expoModulesCoreCppHeaderSearchPaths(s, input.sources)) args.push("-I", p);
  const prefixHeader = prefixHeaderPath(s);
  if (prefixHeader !== undefined) args.push("-include", prefixHeader);
  if (needsReactBridgeModulePreinclude(s, input.sources)) {
    args.push("-include", "React/RCTBridgeModule.h");
  }

  // Preprocessor + flag passthrough
  for (const d of asArray(s.GCC_PREPROCESSOR_DEFINITIONS)) args.push(`-D${d}`);
  for (const f of asArray(s.OTHER_CFLAGS)) args.push(f);
  for (const f of asArray(s.OTHER_CPLUSPLUSFLAGS)) args.push(f);

  // Per-source compile to outputDir
  for (const src of input.sources) {
    const baseNoExt = basename(src).replace(/\.[^.]+$/, "");
    args.push("-c", "-o", `${input.outputDir}/${baseNoExt}.o`, src);
  }

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

function prefixHeaderPath(settings: SettingsDict): string | undefined {
  const path = scalar(settings.GCC_PREFIX_HEADER);
  if (path === undefined || path === "") return undefined;
  if (isAbsolute(path)) return path;

  const projectDir = scalar(settings.PROJECT_DIR) ?? scalar(settings.SRCROOT);
  return projectDir !== undefined && projectDir !== "" ? join(projectDir, path) : path;
}

function needsReactBridgeModulePreinclude(settings: SettingsDict, sources: string[]): boolean {
  return scalar(settings.PRODUCT_MODULE_NAME) === "ExpoModulesCore" && sources.some(isObjCSource);
}

function isObjCSource(src: string): boolean {
  const m = /\.([^./\\]+)$/.exec(src);
  const ext = m?.[1]?.toLowerCase();
  return ext === "m" || ext === "mm";
}

function expoModulesCoreCppHeaderSearchPaths(settings: SettingsDict, sources: string[]): string[] {
  if (scalar(settings.PRODUCT_MODULE_NAME) !== "ExpoModulesCore") return [];

  const paths = new Set<string>();
  for (const source of sources) {
    const marker = "/common/cpp/";
    const idx = source.indexOf(marker);
    if (idx < 0) continue;
    paths.add(`${source.slice(0, idx)}${marker}JSI`);
  }
  return [...paths];
}

/**
 * Classify a source file path by its language family for -std= selection.
 *   .c / .m       → "c"   (C / Obj-C share GCC_C_LANGUAGE_STANDARD)
 *   .cpp/.cc/.cxx/.mm → "cpp" (C++ / Obj-C++ share CLANG_CXX_LANGUAGE_STANDARD)
 *   other         → null  (unknown — don't emit -std= for it)
 */
function sourceLanguage(src: string): "c" | "cpp" | null {
  const m = /\.([^./\\]+)$/.exec(src);
  if (!m) return null;
  const ext = m[1]!.toLowerCase();
  if (ext === "c" || ext === "m") return "c";
  if (ext === "cpp" || ext === "cc" || ext === "cxx" || ext === "mm") return "cpp";
  return null;
}
