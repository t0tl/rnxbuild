import type { ParsedXcconfig } from "@rnxbuild/workspace-parser";
import { resolveLayer, type SettingsDict } from "./resolve.js";
import { selectConditional, type BuildContext } from "./conditions.js";

export interface CascadeInput {
  /** Effective xcconfigs (most-base first). Conditional entries are filtered here. */
  xcconfigs: ParsedXcconfig[];
  projectSettings: SettingsDict;
  targetSettings: SettingsDict;
  configurationSettings: SettingsDict;
  context: BuildContext;
  /**
   * Optional Xcode-built-in environment variables (SRCROOT, PROJECT_DIR,
   * CONFIGURATION, EFFECTIVE_PLATFORM_NAME, etc.) that xcconfigs depend on
   * but don't declare themselves. Applied as the LOWEST-precedence layer
   * (xcconfigs can override). Pass {} or omit for the legacy behavior.
   */
  environment?: SettingsDict;
}

/**
 * Apply the full Xcode build-settings cascade for a single (target, configuration)
 * tuple in a given build context. Order, low → high precedence:
 *   1. xcconfigs (in declaration order, with conditional filtering + two-pass within-config override)
 *   2. PBXProject project-level settings
 *   3. PBXNativeTarget target-level settings
 *   4. XCBuildConfiguration per-configuration settings
 * Higher layers override lower; `$(inherited)` chains across layers.
 */
export function resolveTargetSettings(input: CascadeInput): SettingsDict {
  let acc: SettingsDict = input.environment ?? {};
  for (const xc of input.xcconfigs) {
    const filtered = filterByContext(xc, input.context);
    acc = resolveLayer(filtered, acc);
  }
  acc = resolveLayer(input.projectSettings, acc);
  acc = resolveLayer(input.targetSettings, acc);
  acc = resolveLayer(input.configurationSettings, acc);
  return acc;
}

function filterByContext(xc: ParsedXcconfig, ctx: BuildContext): SettingsDict {
  // Two-pass: unconditional entries first (baseline), then matching conditional
  // entries override. This matches actual Xcode semantics — a conditional
  // SETTING[sdk=iphoneos*] overrides an unconditional SETTING when building
  // for iphoneos, regardless of declaration order in the xcconfig file.
  const out: SettingsDict = {};
  // Pass 1: unconditional entries (always apply; no need to run selectConditional
  // on null — it always returns true). Pass 2 below honors actual conditions.
  for (const s of xc.settings) {
    if (s.condition !== null) continue;
    out[s.key] = s.value;
  }
  for (const s of xc.settings) {
    if (s.condition === null) continue;
    if (!selectConditional(s.key, s.condition, ctx)) continue;
    out[s.key] = s.value;
  }
  return out;
}
