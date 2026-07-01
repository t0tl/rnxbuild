import { substituteVariables } from "./substitute.js";

const MAX_RECURSION = 100;

/**
 * A resolved build-settings value: either a single string OR an ordered array
 * of strings (e.g. OTHER_LDFLAGS). Arrays are preserved end-to-end; the
 * consumer (a CLI-emitter like @rnxbuild/swift-compiler) decides how to join.
 */
export type SettingValue = string | string[];
export type SettingsDict = Record<string, SettingValue>;

/**
 * Resolve a build-settings layer against a parent. Returns the merged, fully-
 * substituted dictionary.
 *
 * Algorithm:
 * 1. Merge parent ∪ child (child overrides parent).
 * 2. For each key whose value mentions $(inherited), expand it against the
 *    parent's value for that same key (or empty if none). Arrays expand
 *    element-wise; strings concatenate space-joined.
 * 3. Iteratively substitute $(VAR) references using the merged dict, until
 *    fixpoint or MAX_RECURSION (cycle detection).
 */
export function resolveLayer(child: SettingsDict, parent: SettingsDict): SettingsDict {
  const merged: SettingsDict = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    merged[k] = resolveInherited(v, parent[k]);
  }

  // Maintain a string-flattened mirror of merged for substitution lookups
  // (arrays are space-joined when referenced as $(VAR)). Updated in lockstep
  // with merged so in-pass mutations are immediately visible to later keys
  // in the same pass — preserves the original eager-update convergence speed.
  const flatDict: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) flatDict[k] = flatten(v);

  for (let pass = 0; pass < MAX_RECURSION; pass++) {
    let changed = false;
    for (const [k, v] of Object.entries(merged)) {
      const next = substituteValue(v, flatDict);
      if (!valueEquals(next, v)) {
        merged[k] = next;
        flatDict[k] = flatten(next);
        changed = true;
      }
    }
    if (!changed) {
      // Fixpoint reached — check for unresolved self-referential cycles.
      for (const v of Object.values(merged)) {
        if (hasUnresolvedRef(v, merged)) {
          throw new Error("Build settings cycle detected: unresolvable self-reference");
        }
      }
      return merged;
    }
  }
  throw new Error(
    `Build settings cycle detected after ${MAX_RECURSION} substitution passes`,
  );
}

function substituteValue(value: SettingValue, flatDict: Record<string, string>): SettingValue {
  if (Array.isArray(value)) return value.map((s) => substituteVariables(s, flatDict));
  return substituteVariables(value, flatDict);
}

function flatten(v: SettingValue): string {
  return Array.isArray(v) ? v.join(" ") : v;
}

function resolveInherited(value: SettingValue, parentValue: SettingValue | undefined): SettingValue {
  if (Array.isArray(value)) {
    // Array inheritance: $(inherited) elements expand to the parent's value (split).
    const out: string[] = [];
    for (const el of value) {
      if (el === "$(inherited)") {
        if (parentValue === undefined) continue;
        if (Array.isArray(parentValue)) out.push(...parentValue);
        else out.push(parentValue);
      } else if (el.includes("$(inherited)")) {
        out.push(...resolveInheritedArrayElement(el, parentValue));
      } else {
        out.push(el);
      }
    }
    return out;
  }
  // Scalar inheritance: substitute $(inherited) with parent's value (joined if array).
  if (!value.includes("$(inherited)")) return value;
  if (Array.isArray(parentValue)) {
    return resolveInheritedArrayElement(value, parentValue);
  }
  const parentResolved = parentValue === undefined
    ? ""
    : parentValue;
  return value.split("$(inherited)").join(parentResolved).replace(/\s+/g, " ").trim();
}

function resolveInheritedArrayElement(
  element: string,
  parentValue: SettingValue | undefined,
): string[] {
  if (!Array.isArray(parentValue)) {
    const parentResolved = parentValue ?? "";
    const resolved = element
      .split("$(inherited)")
      .join(parentResolved)
      .replace(/\s+/g, " ")
      .trim();
    return resolved === "" ? [] : [resolved];
  }

  const out: string[] = [];
  const parts = element.split("$(inherited)");
  parts.forEach((part, index) => {
    const trimmed = part.trim();
    if (trimmed !== "") out.push(trimmed);
    if (index < parts.length - 1) out.push(...parentValue);
  });
  return out;
}

function valueEquals(a: SettingValue, b: SettingValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

function hasUnresolvedRef(value: SettingValue, dict: SettingsDict): boolean {
  const RE = /\$[({]([A-Z_][A-Z0-9_]*)[)}]/gi;
  const strs = Array.isArray(value) ? value : [value];
  for (const s of strs) {
    let m: RegExpExecArray | null;
    while ((m = RE.exec(s)) !== null) {
      const key = m[1];
      if (key !== undefined && key in dict) {
        const target = dict[key];
        const targetStrs = Array.isArray(target) ? target : target === undefined ? [] : [target];
        if (targetStrs.some((t) => t.includes(`$(${key})`))) return true;
      }
    }
  }
  return false;
}
