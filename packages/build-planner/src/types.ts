import type { SettingsDict, BuildContext } from "@rnxbuild/build-settings";

export type SourceLang = "swift" | "objc" | "objcpp" | "c" | "cpp";

export interface BuildPlanTarget {
  /** Stable identifier (PBX target UUID). */
  id: string;
  /** Human-readable name (e.g. "ExpoModulesCore"). */
  name: string;
  /** Module name used by swiftc -module-name. */
  productModuleName: string;
  /** PBX productType. */
  productType: string;
  /** Sources partitioned by language; absolute paths. */
  sources: Record<SourceLang, string[]>;
  /** Fully-resolved + pod-rewritten settings for this target. */
  settings: SettingsDict;
  /** IDs of other BuildPlanTargets this depends on. */
  deps: string[];
  /** Non-source files (asset catalogs, plists); v0.0.6 deferred — always []. */
  resources: string[];
}

export interface BuildPlan {
  targets: BuildPlanTarget[];
  context: BuildContext;
  podsRoot: string;
}
