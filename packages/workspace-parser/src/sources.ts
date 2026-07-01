import { dirname, isAbsolute, join } from "node:path";
import type { XcodeNativeTarget, XcodeProject } from "./project.js";

/**
 * Return the absolute paths of all source files compiled by `target`'s
 * PBXSourcesBuildPhase. Resolves `sourceTree = "<group>"` against the
 * enclosing group's path, `SOURCE_ROOT` against the project's parent dir,
 * `<absolute>` as-is. Skips `BUILT_PRODUCTS_DIR`, `SDKROOT`, `DEVELOPER_DIR`
 * (at-build-time paths Plan 2 doesn't resolve) and any reference we can't
 * classify, emitting nothing for them.
 */
export function targetSourceFiles(target: XcodeNativeTarget, project: XcodeProject): string[] {
  const objects = project.objects;
  const projectDir = dirname(project.path);

  const sourcePhaseIds = target.buildPhaseIds.filter((id) => {
    const o = objects[id];
    return o?.isa === "PBXSourcesBuildPhase";
  });

  const out: string[] = [];
  for (const phaseId of sourcePhaseIds) {
    const phase = objects[phaseId]!;
    const fileIds = (phase.files as string[] | undefined) ?? [];
    for (const fid of fileIds) {
      const buildFile = objects[fid];
      if (!buildFile || buildFile.isa !== "PBXBuildFile") continue;
      const refId = buildFile.fileRef as string | undefined;
      if (!refId) continue;
      const resolved = resolveInternal(refId, objects, projectDir);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}

/**
 * Resolve a PBXFileReference ID to an absolute path.
 * Returns null if `refId` is undefined or the reference cannot be resolved.
 * Ergonomic wrapper for callers that hold an optional reference ID (e.g.
 * `XCBuildConfiguration.baseConfigurationReference`).
 */
export function resolveFileReferencePath(
  refId: string | undefined,
  project: XcodeProject,
): string | null {
  if (!refId) return null;
  return resolveInternal(refId, project.objects, dirname(project.path));
}

function resolveInternal(
  refId: string,
  objects: Record<string, Record<string, unknown>>,
  projectDir: string,
): string | null {
  const ref = objects[refId];
  if (!ref) return null;
  if (ref.isa !== "PBXFileReference") {
    // PBXReferenceProxy and similar — Plan 2 skips
    return null;
  }
  const path = typeof ref.path === "string" ? ref.path : "";
  if (!path) return null;
  const tree = typeof ref.sourceTree === "string" ? ref.sourceTree : "";

  if (tree === "<absolute>") return path;
  if (tree === "SOURCE_ROOT") return join(projectDir, path);
  if (tree === "<group>") {
    const groupPath = resolveGroupPath(refId, objects, projectDir);
    return groupPath === null ? null : join(groupPath, path);
  }
  if (tree === "BUILT_PRODUCTS_DIR" || tree === "SDKROOT" || tree === "DEVELOPER_DIR") {
    // Build-time-resolved paths; Plan 2 skips
    return null;
  }
  // Unknown sourceTree — skip
  return null;
}

/** Walk up the PBXGroup tree to compute the absolute on-disk path of the group
 *  containing `refId`. Returns null if any ancestor uses an at-build-time tree. */
function resolveGroupPath(
  refId: string,
  objects: Record<string, Record<string, unknown>>,
  projectDir: string,
): string | null {
  // Find the PBXGroup whose `children` includes refId.
  const groupId = Object.keys(objects).find((id) => {
    const o = objects[id]!;
    if (o.isa !== "PBXGroup" && o.isa !== "PBXVariantGroup") return false;
    const children = (o.children as string[] | undefined) ?? [];
    return children.includes(refId);
  });
  if (!groupId) return projectDir; // orphan — assume project root
  const group = objects[groupId]!;
  const groupPath = typeof group.path === "string" ? group.path : undefined;
  const groupTree = typeof group.sourceTree === "string" ? group.sourceTree : "<group>";
  const parent =
    groupTree === "<group>"
      ? resolveGroupPath(groupId, objects, projectDir)
      : groupTree === "SOURCE_ROOT"
        ? projectDir
        : groupTree === "<absolute>"
          ? ""
          : null;
  if (parent === null) return null;
  if (!groupPath) return parent;
  if (isAbsolute(groupPath)) return groupPath;
  return join(parent, groupPath);
}
