import type { BuildContext, SettingsDict, SettingValue } from "@rnxbuild/build-settings";

export interface LinkerArgsInput {
  /** Fully-resolved Xcode build settings for the target being linked. */
  settings: SettingsDict;
  /** Build context (sdk, arch, config). */
  context: BuildContext;
  /** PBX productType gates dynamic library flags. */
  productType: string;
  /** Module / product name for output filename and install name. */
  productModuleName: string;
  /** Absolute paths to `.o` files. The driver materializes these into a filelist. */
  objectFiles: string[];
  /** Where the linked binary lands. */
  outputPath: string;
  /** Absolute path to the iOS SDK root. */
  sdkPath: string;
  /** Static library names to link via `-l<name>`. */
  staticLibraries?: string[];
  /** Frameworks to link via `-framework <Name>`. */
  frameworks?: string[];
  /** Frameworks to link via `-weak_framework <Name>`. */
  weakFrameworks?: string[];
  /** Absolute `.swiftmodule` paths to embed via `-Xlinker -add_ast_path`. */
  swiftModulesToEmbed?: string[];
}

const DEFAULT_DEPLOYMENT_TARGET = "17.0";

const DYLIB_PRODUCT_TYPES = new Set([
  "com.apple.product-type.framework",
  "com.apple.product-type.library.dynamic",
]);

/**
 * Pure: translate Xcode build settings + linker inputs into a clang link argv.
 * Caller wraps this as `clang ${args}`; `clang` itself is not included.
 */
export function buildLinkerArgs(input: LinkerArgsInput): string[] {
  const args: string[] = [];
  const s = input.settings;
  const isDylib = DYLIB_PRODUCT_TYPES.has(input.productType);

  args.push("-Xlinker", "-reproducible");

  const deploymentTarget = scalar(s.IPHONEOS_DEPLOYMENT_TARGET) ?? DEFAULT_DEPLOYMENT_TARGET;
  args.push("-target", `${input.context.arch}-apple-ios${deploymentTarget}`);

  if (isDylib) {
    args.push("-dynamiclib");
  }

  args.push("-isysroot", input.sdkPath);

  const opt = scalar(s.GCC_OPTIMIZATION_LEVEL);
  args.push(`-O${opt && opt !== "" ? opt : "0"}`);

  for (const p of asArray(s.LIBRARY_SEARCH_PATHS)) args.push("-L", p);
  args.push("-L", `${input.sdkPath}/usr/lib/swift`);

  for (const p of asArray(s.FRAMEWORK_SEARCH_PATHS)) args.push("-F", p);

  pushRpath(args, "@executable_path");
  pushRpath(args, "/usr/lib/swift");
  pushRpath(args, "@executable_path/Frameworks");
  pushRpath(args, "@loader_path/Frameworks");
  for (const p of asArray(s.LD_RUNPATH_SEARCH_PATHS)) pushRpath(args, p);

  args.push("-Xlinker", "-dead_strip");
  args.push("-rdynamic");
  args.push("-Xlinker", "-no_deduplicate");
  args.push("-fobjc-link-runtime");

  for (const modulePath of input.swiftModulesToEmbed ?? []) {
    args.push("-Xlinker", "-add_ast_path", "-Xlinker", modulePath);
  }

  args.push("-ObjC");

  for (const name of input.staticLibraries ?? []) args.push(`-l${name}`);

  if (scalar(s.CLANG_CXX_LIBRARY) !== "none") {
    args.push("-lc++");
  }

  for (const name of input.frameworks ?? []) args.push("-framework", name);
  for (const name of input.weakFrameworks ?? []) args.push("-weak_framework", name);
  for (const flag of asArray(s.OTHER_LDFLAGS)) args.push(flag);

  args.push("-o", input.outputPath);

  if (isDylib) {
    args.push("-install_name", installNameFor(input.productType, input.productModuleName, input.outputPath));
  }

  return args;
}

function installNameFor(productType: string, moduleName: string, outputPath: string): string {
  if (productType === "com.apple.product-type.framework") {
    return `@rpath/${moduleName}.framework/${moduleName}`;
  }
  const filename = outputPath.slice(outputPath.lastIndexOf("/") + 1);
  return `@rpath/${filename}`;
}

function pushRpath(args: string[], path: string): void {
  args.push("-Xlinker", "-rpath", "-Xlinker", path);
}

function scalar(v: SettingValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(" ") : v;
}

function asArray(v: SettingValue | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
