import { describe, expect, it } from "vitest";
import { topologicalTiers } from "../src/index.js";

describe("topologicalTiers", () => {
  it("returns a single tier when no nodes have deps", () => {
    const result = topologicalTiers([
      { id: "a", deps: [] },
      { id: "b", deps: [] },
      { id: "c", deps: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("groups by dependency depth", () => {
    const result = topologicalTiers([
      { id: "a", deps: [] },
      { id: "b", deps: ["a"] },
      { id: "c", deps: ["b"] },
      { id: "d", deps: ["a"] },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]!.map((n) => n.id).sort()).toEqual(["a"]);
    expect(result[1]!.map((n) => n.id).sort()).toEqual(["b", "d"]);
    expect(result[2]!.map((n) => n.id).sort()).toEqual(["c"]);
  });

  it("places a node in the tier AFTER its deepest dep (multi-dep depth)", () => {
    // c depends on a (tier 0) AND b (tier 1) — must land in tier 2
    const result = topologicalTiers([
      { id: "a", deps: [] },
      { id: "b", deps: ["a"] },
      { id: "c", deps: ["a", "b"] },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]!.map((n) => n.id)).toEqual(["a"]);
    expect(result[1]!.map((n) => n.id)).toEqual(["b"]);
    expect(result[2]!.map((n) => n.id)).toEqual(["c"]);
  });

  it("silently drops unknown dep ids (treats them as already-built)", () => {
    const result = topologicalTiers([
      { id: "a", deps: ["nonexistent"] },
      { id: "b", deps: ["a"] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.map((n) => n.id)).toEqual(["a"]);
    expect(result[1]!.map((n) => n.id)).toEqual(["b"]);
  });

  it("throws on a cycle, naming the involved nodes", () => {
    expect(() =>
      topologicalTiers([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["a"] },
      ]),
    ).toThrow(/cycle.*a.*b|cycle.*b.*a/);
  });
});
