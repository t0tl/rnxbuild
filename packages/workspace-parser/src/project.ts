import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "@bacons/xcode/json";
import { tokenizeXcconfigValue } from "./xcconfig.js";

export type BuildSettings = Record<string, string | string[]>;

const LIST_VALUED_BUILD_SETTINGS = new Set([
  "FRAMEWORK_SEARCH_PATHS",
  "HEADER_SEARCH_PATHS",
  "LD_RUNPATH_SEARCH_PATHS",
  "LIBRARY_SEARCH_PATHS",
  "OTHER_CFLAGS",
  "OTHER_CPLUSPLUSFLAGS",
  "OTHER_LDFLAGS",
  "OTHER_SWIFT_FLAGS",
  "SWIFT_INCLUDE_PATHS",
]);

export interface XcodeBuildConfiguration {
  name: string;
  buildSettings: BuildSettings;
  baseConfigurationReference?: string;
}

export interface XcodeNativeTarget {
  id: string;
  name: string;
  productType: string;
  configurations: XcodeBuildConfiguration[];
  buildPhaseIds: string[];
  dependencies: string[];
}

export interface XcodeProject {
  path: string;
  targets: XcodeNativeTarget[];
  projectConfigurations: XcodeBuildConfiguration[];
  objects: Record<string, Record<string, unknown>>;
}

type RawObject = Record<string, unknown> & { isa?: string };
type RawObjects = Record<string, RawObject>;

export async function parseProject(projectPath: string): Promise<XcodeProject> {
  const pbxprojPath = join(projectPath, "project.pbxproj");
  const text = await readFile(pbxprojPath, "utf8");
  const parsed = parse(text);

  const objects = parsed.objects as unknown as RawObjects;

  const project = Object.values(objects).find((o) => o.isa === "PBXProject");
  if (!project) throw new Error(`No PBXProject found in ${pbxprojPath}`);

  const projectConfigurations = readConfigurations(
    objects,
    project.buildConfigurationList as string,
  );

  const targetIds = (project.targets as string[] | undefined) ?? [];
  const targets: XcodeNativeTarget[] = targetIds
    .map((id) => ({ id, raw: objects[id] }))
    .filter((e): e is { id: string; raw: RawObject } => e.raw?.isa === "PBXNativeTarget")
    .map(({ id, raw: t }) => ({
      id,
      name: String(t.name),
      productType: String(t.productType),
      configurations: readConfigurations(objects, t.buildConfigurationList as string),
      buildPhaseIds: (t.buildPhases as string[] | undefined) ?? [],
      dependencies: extractDependencies(objects, (t.dependencies as string[] | undefined) ?? []),
    }));

  return { path: projectPath, targets, projectConfigurations, objects };
}

function readConfigurations(
  objects: RawObjects,
  listId: string,
): XcodeBuildConfiguration[] {
  const list = objects[listId];
  if (!list || list.isa !== "XCConfigurationList") return [];
  const configIds = (list.buildConfigurations as string[] | undefined) ?? [];
  return configIds
    .map((id) => objects[id])
    .filter((o): o is RawObject => o?.isa === "XCBuildConfiguration")
    .map((c) => ({
      name: String(c.name),
      buildSettings: normalizeBuildSettings(c.buildSettings),
      baseConfigurationReference:
        typeof c.baseConfigurationReference === "string"
          ? c.baseConfigurationReference
          : undefined,
    }));
}

function normalizeBuildSettings(raw: unknown): BuildSettings {
  if (!raw || typeof raw !== "object") return {};
  const out: BuildSettings = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      // pbxproj scalar values: tokenize when they contain $(inherited) — that's
      // the signal the setting is intended as a multi-token expression composing
      // with a parent array (e.g. OTHER_SWIFT_FLAGS = "$(inherited) -D FOO").
      // Also tokenize known list-valued build settings; CocoaPods sometimes
      // serializes them as whitespace-separated pbxproj scalars without
      // $(inherited). For other values, preserve as scalar — splitting
      // INFOPLIST_KEY_* multi-word English strings or unquoted bundle IDs would
      // be wrong. Plan-3 Wall A fix.
      out[key] =
        value.includes("$(inherited)") || LIST_VALUED_BUILD_SETTINGS.has(key)
          ? tokenizeXcconfigValue(value)
          : value;
    } else if (Array.isArray(value)) {
      const arr: string[] = [];
      for (const item of value) {
        const c = coerceScalar(item);
        if (c !== undefined && typeof c === "string") arr.push(c);
      }
      out[key] = arr;
    } else {
      const coerced = coerceScalar(value);
      if (coerced !== undefined) out[key] = coerced;
    }
  }
  return out;
}

function coerceScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function extractDependencies(objects: RawObjects, depIds: string[]): string[] {
  const out: string[] = [];
  for (const depId of depIds) {
    const dep = objects[depId];
    if (!dep || dep.isa !== "PBXTargetDependency") continue;
    const targetId = dep.target;
    if (typeof targetId === "string") out.push(targetId);
  }
  return out;
}
