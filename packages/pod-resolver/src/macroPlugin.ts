import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SettingsDict, SettingValue } from "@rnxbuild/build-settings";

const OTHER_SWIFT_FLAGS_KEY = "OTHER_SWIFT_FLAGS";
const EXPO_MACRO_TOOL = "ExpoModulesMacros-tool";

export interface MacroPluginRewriteOptions {
  /** Host triple used by SwiftPM for macro plugin executables. Defaults from process.arch. */
  hostTriple?: string;
}

/**
 * Swift macro plugins execute on the build host, not the target platform.
 * Expo's npm package ships a macOS universal ExpoModulesMacros-tool, which
 * fails with Exec format error on Linux. When a Linux SwiftPM build of that
 * tool exists next to the package, rewrite -load-plugin-executable paths to it.
 */
export async function rewriteMacroPluginPaths(
  settings: SettingsDict,
  opts: MacroPluginRewriteOptions = {},
): Promise<SettingsDict> {
  const out: SettingsDict = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key === OTHER_SWIFT_FLAGS_KEY) {
      out[key] = await rewriteValue(value, opts);
    } else {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out;
}

async function rewriteValue(
  value: SettingValue,
  opts: MacroPluginRewriteOptions,
): Promise<SettingValue> {
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const token of value) out.push(await rewriteToken(token, opts));
    return out;
  }
  return rewriteToken(value, opts);
}

async function rewriteToken(token: string, opts: MacroPluginRewriteOptions): Promise<string> {
  const [toolPath, pluginName] = splitPluginSpecifier(token);
  if (!toolPath.endsWith(`/${EXPO_MACRO_TOOL}`) && toolPath !== EXPO_MACRO_TOOL) return token;

  const hostTool = join(
    dirname(toolPath),
    ".build",
    opts.hostTriple ?? hostTriple(),
    "release",
    EXPO_MACRO_TOOL,
  );
  if (!(await pathExists(hostTool))) return token;

  return pluginName ? `${hostTool}#${pluginName}` : hostTool;
}

function splitPluginSpecifier(token: string): [string, string | undefined] {
  const idx = token.indexOf("#");
  if (idx < 0) return [token, undefined];
  return [token.slice(0, idx), token.slice(idx + 1)];
}

function hostTriple(): string {
  switch (process.arch) {
    case "x64":
      return "x86_64-unknown-linux-gnu";
    case "arm64":
      return "aarch64-unknown-linux-gnu";
    default:
      return `${process.arch}-unknown-linux-gnu`;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
