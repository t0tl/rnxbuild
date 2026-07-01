import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";

export interface WorkspaceProjectRef {
  /** Path to the .xcodeproj, relative to the workspace's containing directory. */
  location: string;
  /** `group`, `container`, or `absolute` — controls how `location` is resolved. */
  scheme: "group" | "container" | "absolute";
}

export interface Workspace {
  /** Absolute path to the .xcworkspace directory. */
  path: string;
  /** Project references in workspace declaration order. */
  projects: WorkspaceProjectRef[];
}

interface RawFileRef {
  "@_location"?: string;
}

interface RawWorkspace {
  Workspace?: {
    FileRef?: RawFileRef | RawFileRef[];
  };
}

export async function parseWorkspace(workspacePath: string): Promise<Workspace> {
  const contentsPath = join(workspacePath, "contents.xcworkspacedata");
  try {
    await stat(contentsPath);
  } catch {
    throw new Error(`contents.xcworkspacedata not found at ${contentsPath}`);
  }
  const xml = await readFile(contentsPath, "utf8");
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as RawWorkspace;

  const refsRaw = parsed.Workspace?.FileRef;
  const refs: RawFileRef[] = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];

  const projects: WorkspaceProjectRef[] = refs
    .map((ref) => parseLocationAttr(ref["@_location"] ?? ""))
    .filter((p): p is WorkspaceProjectRef => p !== null);

  return { path: workspacePath, projects };
}

function parseLocationAttr(loc: string): WorkspaceProjectRef | null {
  const colon = loc.indexOf(":");
  if (colon < 0) return null;
  const scheme = loc.slice(0, colon);
  const location = loc.slice(colon + 1);
  if (scheme !== "group" && scheme !== "container" && scheme !== "absolute") return null;
  return { location, scheme };
}
