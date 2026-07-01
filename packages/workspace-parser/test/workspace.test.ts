import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseWorkspace } from "../src/workspace.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "fixtures/sample.xcworkspace");

describe("parseWorkspace", () => {
  it("lists project references in declaration order", async () => {
    const ws = await parseWorkspace(fixture);
    expect(ws.projects).toEqual([
      { location: "HelloApp.xcodeproj", scheme: "group" },
      { location: "Pods/Pods.xcodeproj", scheme: "group" },
    ]);
    expect(ws.path).toBe(fixture);
  });

  it("throws a helpful error when the .xcworkspace is missing", async () => {
    await expect(parseWorkspace("/nonexistent/Missing.xcworkspace")).rejects.toThrow(
      /contents\.xcworkspacedata not found/,
    );
  });
});
