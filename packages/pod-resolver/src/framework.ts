import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BuildContext, SettingsDict, SettingValue } from "@rnxbuild/build-settings";

export interface FrameworkSearchPathRewriteOptions {
  /** Absolute path to the Pods/ directory. */
  podsRoot: string;
  /** Build context — used to select the per-arch slice from .xcframework directories. */
  context: BuildContext;
}

const FRAMEWORK_SEARCH_PATHS_KEY = "FRAMEWORK_SEARCH_PATHS";
const INHERITED = "$(inherited)";

/**
 * Pure async: scan `FRAMEWORK_SEARCH_PATHS` entries (string OR array). For each
 * entry that doesn't exist on disk, try to identify the prebuilt `.xcframework`
 * it's pointing at — CocoaPods's `${PODS_XCFRAMEWORKS_BUILD_DIR}/<Name>` is a
 * build-time path; the real prebuilt slices live in the source tree under
 * `${podsRoot}/<Name>/.../*.xcframework/<slice>/`.
 *
 * The rewrite resolves to the per-arch slice directory itself (a directory
 * containing `<Name>.framework/`), which is what swiftc/clang `-F<path>`
 * expects. Other setting keys are passed through untouched. `$(inherited)`
 * literals and entries that already exist on disk are left alone. Same
 * informative-error fallback as `rewriteModulemapPaths`: when no plausible
 * xcframework or matching slice can be found, the original entry is preserved
 * so any subsequent error keeps its descriptive path.
 */
export async function rewriteFrameworkSearchPaths(
  settings: SettingsDict,
  opts: FrameworkSearchPathRewriteOptions,
): Promise<SettingsDict> {
  const out: SettingsDict = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key === FRAMEWORK_SEARCH_PATHS_KEY) {
      out[key] = await rewriteValue(value, opts);
    } else {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out;
}

async function rewriteValue(
  value: SettingValue,
  opts: FrameworkSearchPathRewriteOptions,
): Promise<SettingValue> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((tok) => rewriteEntry(tok, opts)));
  }
  return rewriteEntry(value, opts);
}

async function rewriteEntry(
  entry: string,
  opts: FrameworkSearchPathRewriteOptions,
): Promise<string> {
  if (entry === "" || entry === INHERITED) return entry;
  const existingXcframework = await findXcframeworkUnder(entry);
  if (existingXcframework !== null) {
    const slice = await pickSlice(existingXcframework, opts.context);
    if (slice !== null) return join(existingXcframework, slice);
  }
  if (await pathExists(entry)) return entry;

  const candidateRoot = await findCandidateRoot(entry, opts.podsRoot);
  if (candidateRoot === null) return entry;

  const xcframework = await findXcframeworkUnder(candidateRoot);
  if (xcframework === null) return entry;

  const slice = await pickSlice(xcframework, opts.context);
  if (slice === null) return entry;

  return join(xcframework, slice);
}

/**
 * Given a missing entry, find the `${podsRoot}/<name>` directory it's trying
 * to reference. CocoaPods sometimes appends a sub-segment (e.g. `Pre-built`)
 * that doesn't match a Pods/ child; walk UP the entry path looking for any
 * segment that does.
 */
async function findCandidateRoot(entry: string, podsRoot: string): Promise<string | null> {
  let cursor = entry;
  while (cursor !== "" && cursor !== "/" && cursor !== ".") {
    const name = basename(cursor);
    if (name === "") break;
    const candidate = join(podsRoot, name);
    if (await pathExists(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

/**
 * Look for any `*.xcframework` directly under `root` or one level deep under
 * each subdirectory. Intentionally bounded (no deep recursion) — the three
 * shapes we observe in the wild are:
 *   - direct:  Pods/<name>/<X>.xcframework
 *   - nested:  Pods/<name>/framework/packages/react-native/<X>.xcframework
 *   - deeper:  Pods/<name>/destroot/Library/Frameworks/universal/<X>.xcframework
 *
 * We search a few known subpaths in order to handle these without scanning
 * the whole tree.
 */
async function findXcframeworkUnder(root: string): Promise<string | null> {
  const knownSubpaths = [
    "",
    "framework/packages/react-native",
    "destroot/Library/Frameworks/universal",
  ];
  for (const sub of knownSubpaths) {
    const dir = sub === "" ? root : join(root, sub);
    const match = await firstXcframeworkInDir(dir);
    if (match !== null) return match;
  }
  return null;
}

async function firstXcframeworkInDir(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  // Sort for deterministic selection across filesystems / CI / dev boxes —
  // readdir order is not portable when multiple .xcframework siblings exist.
  entries.sort();
  for (const entry of entries) {
    if (entry.endsWith(".xcframework")) {
      const full = join(dir, entry);
      if (await isDirectory(full)) return full;
    }
  }
  return null;
}

/**
 * Pick the best per-arch slice from an .xcframework given the build context.
 *
 * iphoneos + arm64        -> exact "ios-arm64" wins; else any ios- slice with
 *                            arm64 that is NOT a simulator/maccatalyst slice.
 * iphonesimulator + arm64 -> any ios- slice containing both arm64 AND
 *                            simulator.
 *
 * Returns the slice directory NAME (relative to the xcframework root) or
 * null when nothing plausible matches.
 */
async function pickSlice(xcframework: string, context: BuildContext): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(xcframework);
  } catch {
    return null;
  }
  // Sort for deterministic selection across filesystems / CI / dev boxes —
  // readdir order is not portable when multiple matching slices exist.
  entries.sort();
  const slices: string[] = [];
  for (const entry of entries) {
    if (await isDirectory(join(xcframework, entry))) slices.push(entry);
  }

  const platformPrefix = sdkPlatformPrefix(context.sdk);
  if (platformPrefix === null) return null;
  const wantSimulator = context.sdk.startsWith("iphonesimulator");

  // Exact "ios-arm64" win for device builds.
  if (platformPrefix === "ios-" && !wantSimulator) {
    const exact = `ios-${context.arch}`;
    if (slices.includes(exact)) return exact;
  }

  for (const slice of slices) {
    if (!slice.startsWith(platformPrefix)) continue;
    if (!hasArchToken(slice, context.arch)) continue;
    const isSimSlice = slice.includes("simulator");
    const isMaccatalystSlice = slice.includes("maccatalyst");
    if (wantSimulator) {
      if (isSimSlice) return slice;
    } else {
      if (!isSimSlice && !isMaccatalystSlice) return slice;
    }
  }
  return null;
}

/**
 * Match `arch` as a whole token within a slice name. Slice names tokenize on
 * `-` and `_` (e.g. `ios-arm64_x86_64-simulator`). A naive substring check
 * would treat `ios-arm64e` as containing `arm64` and silently pick a
 * pointer-authenticated arm64e binary for an arch:arm64 build.
 */
function hasArchToken(slice: string, arch: string): boolean {
  return slice.split(/[-_]/).includes(arch);
}

function sdkPlatformPrefix(sdk: string): string | null {
  if (sdk.startsWith("iphoneos") || sdk.startsWith("iphonesimulator")) return "ios-";
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
