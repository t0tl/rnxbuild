import type { SettingsDict, SettingValue } from "@rnxbuild/build-settings";

export interface DeriveDepsInput {
  /** Target IDs from PBXTargetDependency (already resolved to IDs). */
  explicitDepIds: string[];
  /** Fully-resolved settings for the target whose deps we're deriving. */
  settings: SettingsDict;
  /** All targets known to the plan. Used to resolve names → ids. */
  candidateTargets: { id: string; name: string }[];
}

const PODS_BUILD_DIR_REFS = [
  "${PODS_CONFIGURATION_BUILD_DIR}/",
  "$(PODS_CONFIGURATION_BUILD_DIR)/",
];

/**
 * Derive a target's dependency edges from two sources:
 *
 *   1. EXPLICIT: PBXTargetDependency records (passed in as `explicitDepIds`).
 *   2. IMPLICIT: heuristics over `FRAMEWORK_SEARCH_PATHS` and `OTHER_LDFLAGS`
 *      that reference other target names via `${PODS_CONFIGURATION_BUILD_DIR}/<Name>`
 *      or `-l <Name>`. Names that don't match any known target are dropped.
 *
 * Returns a deduplicated list of target IDs.
 */
export function deriveDeps(input: DeriveDepsInput): string[] {
  const byName = new Map(input.candidateTargets.map((t) => [t.name, t.id]));
  const seen = new Set<string>(input.explicitDepIds);

  for (const entry of asArray(input.settings.FRAMEWORK_SEARCH_PATHS)) {
    for (const prefix of PODS_BUILD_DIR_REFS) {
      const idx = entry.indexOf(prefix);
      if (idx < 0) continue;
      const rest = entry.slice(idx + prefix.length);
      const m = /^["']?([^"' /]+)/.exec(rest);
      if (!m) continue;
      const name = m[1]!;
      const id = byName.get(name);
      if (id) seen.add(id);
    }
  }

  const ldflags = asArray(input.settings.OTHER_LDFLAGS);
  for (let i = 0; i < ldflags.length; i++) {
    const tok = ldflags[i]!;
    if (tok === "-l" && i + 1 < ldflags.length) {
      const name = stripQuotes(ldflags[i + 1]!);
      const id = byName.get(name);
      if (id) seen.add(id);
    } else if (tok.startsWith("-l")) {
      const name = stripQuotes(tok.slice(2));
      const id = byName.get(name);
      if (id) seen.add(id);
    }
  }

  return [...seen];
}

function asArray(v: SettingValue | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}
