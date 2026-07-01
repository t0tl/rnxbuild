import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { SettingsDict, SettingValue } from "@rnxbuild/build-settings";

export interface PodPathRewriteOptions {
  /** Absolute path to the Pods/ directory. */
  podsRoot: string;
}

const FLAG_PREFIX = "-fmodule-map-file=";

/**
 * Pure async: scan setting values (strings AND arrays) for tokens matching
 * `-fmodule-map-file=<path>`.
 *
 * - When `<path>` doesn't exist on disk but the canonical CocoaPods source-tree
 *   location `${podsRoot}/Target Support Files/<Pod>/<Pod>.modulemap` does,
 *   rewrite to the existing file.
 * - When `<path>` is MALFORMED (empty, ends in `/`, or doesn't end in
 *   `.modulemap`), DROP the token (and the preceding `-Xcc` if present).
 *   Production Xcode would never emit this argv shape; it's the result of an
 *   xcconfig variable substitution leaving an empty path component (e.g.
 *   `${SRCROOT}/${MODULEMAP_FILE}` when `MODULEMAP_FILE` is unset). Leaving
 *   the token in place breaks swiftc/clang with a confusing 'missing required
 *   module' cascade.
 * - Otherwise leave the token unchanged (informative-error fallback so any
 *   subsequent error keeps a real path).
 */
export async function rewriteModulemapPaths(
  settings: SettingsDict,
  opts: PodPathRewriteOptions,
): Promise<SettingsDict> {
  const out: SettingsDict = {};
  for (const [key, value] of Object.entries(settings)) {
    out[key] = await rewriteValue(value, opts);
  }
  return out;
}

async function rewriteValue(value: SettingValue, opts: PodPathRewriteOptions): Promise<SettingValue> {
  if (Array.isArray(value)) {
    // Two-pass: transform each token to either a string (keep/rewrite) or null
    // (drop). Then walk the result and also drop any `-Xcc` whose immediately-
    // following token was dropped.
    const transformed = await Promise.all(value.map((tok) => transformToken(tok, opts)));
    const kept: string[] = [];
    for (let i = 0; i < transformed.length; i++) {
      const cur = transformed[i]!;
      const next = i + 1 < transformed.length ? transformed[i + 1] : undefined;
      // Drop a `-Xcc` whose paired flag in the next slot was dropped (null).
      if (cur === "-Xcc" && next === null) continue;
      if (cur === null) continue;
      kept.push(cur);
    }
    return kept;
  }
  // Scalar string: transform; null collapses to "" (caller can decide, but
  // scalar fmodule-map-file tokens are unusual — keep the existing behavior of
  // returning the original on drop-vs-keep ambiguity for scalars by returning "").
  const t = await transformToken(value, opts);
  return t ?? "";
}

/**
 * Transform a single token. Returns:
 *   - a string when keep-or-rewrite applies
 *   - null when the token should be dropped (caller filters)
 */
async function transformToken(token: string, opts: PodPathRewriteOptions): Promise<string | null> {
  const idx = token.indexOf(FLAG_PREFIX);
  if (idx < 0) return token; // not a -fmodule-map-file= token; keep as-is
  const path = token.slice(idx + FLAG_PREFIX.length);
  // Malformed shapes — drop entirely
  if (path === "") return null;
  if (path.endsWith("/")) return null;
  if (!path.endsWith(".modulemap")) return null;
  // Well-formed: existing file → keep; existing rewrite target → rewrite; else keep (informative)
  if (await fileExists(path)) return token;
  const podName = basename(dirname(path));
  if (!podName) return token;
  const candidate = `${opts.podsRoot}/Target Support Files/${podName}/${basename(path)}`;
  if (await fileExists(candidate)) {
    return token.slice(0, idx) + FLAG_PREFIX + candidate;
  }
  return token;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
