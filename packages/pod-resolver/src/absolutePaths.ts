import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { SettingsDict, SettingValue } from "@rnxbuild/build-settings";

export interface AbsolutePathRewriteOptions {
  /** Path to the current checkout's ios/Pods directory. */
  podsRoot: string;
  /** Path to the current app checkout root. Defaults from podsRoot. */
  projectRoot?: string;
}

interface PathRoots {
  podsRoot: string;
  iosRoot: string;
  projectRoot: string;
}

/**
 * CocoaPods snapshots may contain absolute paths from the machine that captured
 * them. Rebase only recognizable, missing paths whose suffix exists in the
 * current checkout; keep everything else unchanged for debuggable failures.
 */
export async function rewriteRelocatedAbsolutePaths(
  settings: SettingsDict,
  opts: AbsolutePathRewriteOptions,
): Promise<SettingsDict> {
  const roots = pathRoots(opts);
  const out: SettingsDict = {};

  for (const [key, value] of Object.entries(settings)) {
    out[key] = await rewriteValue(value, roots);
  }

  return out;
}

async function rewriteValue(value: SettingValue, roots: PathRoots): Promise<SettingValue> {
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const token of value) out.push(await rewriteToken(token, roots));
    return out;
  }
  return rewriteToken(value, roots);
}

async function rewriteToken(token: string, roots: PathRoots): Promise<string> {
  const [withoutPluginName, pluginName] = splitPluginSpecifier(token);
  const rewritten = await rewritePathCarrier(withoutPluginName, roots);
  return pluginName ? `${rewritten}#${pluginName}` : rewritten;
}

async function rewritePathCarrier(value: string, roots: PathRoots): Promise<string> {
  const quoted = splitWrappingQuote(value);
  if (quoted) {
    return `${quoted.quote}${await rewritePathCarrier(quoted.inner, roots)}${quoted.quote}`;
  }

  const modulemapPrefix = "-fmodule-map-file=";
  if (value.startsWith(modulemapPrefix)) {
    return `${modulemapPrefix}${await rewritePath(value.slice(modulemapPrefix.length), roots)}`;
  }

  const fileUrlPrefix = "file://";
  if (value.startsWith(fileUrlPrefix)) {
    return `${fileUrlPrefix}${await rewritePath(value.slice(fileUrlPrefix.length), roots)}`;
  }

  return rewritePath(value, roots);
}

async function rewritePath(path: string, roots: PathRoots): Promise<string> {
  if (!isAbsolute(path)) return path;
  if (await pathExists(path)) return path;

  const candidates = [
    rebaseAfterAnchor(path, "/ios/Pods/", roots.podsRoot),
    rebaseAfterAnchor(path, "/ios/", roots.iosRoot),
    rebaseAfterAnchor(path, "/node_modules/", join(roots.projectRoot, "node_modules")),
  ].filter((candidate): candidate is string => candidate !== null);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  return path;
}

function rebaseAfterAnchor(path: string, anchor: string, base: string): string | null {
  const idx = path.indexOf(anchor);
  if (idx < 0) return null;
  return join(base, path.slice(idx + anchor.length));
}

function pathRoots(opts: AbsolutePathRewriteOptions): PathRoots {
  const iosRoot = dirname(opts.podsRoot);
  const projectRoot = opts.projectRoot ?? (basename(iosRoot) === "ios" ? dirname(iosRoot) : iosRoot);
  return { podsRoot: opts.podsRoot, iosRoot, projectRoot };
}

function splitPluginSpecifier(token: string): [string, string | undefined] {
  const idx = token.indexOf("#");
  if (idx < 0) return [token, undefined];
  return [token.slice(0, idx), token.slice(idx + 1)];
}

function splitWrappingQuote(value: string): { quote: string; inner: string } | null {
  if (value.length < 2) return null;
  const first = value[0]!;
  if ((first !== "\"" && first !== "'") || value[value.length - 1] !== first) return null;
  return { quote: first, inner: value.slice(1, -1) };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
