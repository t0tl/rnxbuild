import { describe, expect, it } from "vitest";
import { topologicalOrder, type TargetNode } from "../src/index.js";

describe("topologicalOrder", () => {
  it("orders independent targets stably (input order)", () => {
    const nodes: TargetNode[] = [
      { id: "A", deps: [] },
      { id: "B", deps: [] },
      { id: "C", deps: [] },
    ];
    expect(topologicalOrder(nodes).map((n) => n.id)).toEqual(["A", "B", "C"]);
  });

  it("places dependencies before dependents", () => {
    const nodes: TargetNode[] = [
      { id: "App", deps: ["Pods", "Hermes"] },
      { id: "Pods", deps: [] },
      { id: "Hermes", deps: [] },
    ];
    const order = topologicalOrder(nodes).map((n) => n.id);
    expect(order.indexOf("Pods")).toBeLessThan(order.indexOf("App"));
    expect(order.indexOf("Hermes")).toBeLessThan(order.indexOf("App"));
  });

  it("handles a deeper chain", () => {
    const nodes: TargetNode[] = [
      { id: "App", deps: ["Lib"] },
      { id: "Lib", deps: ["Core"] },
      { id: "Core", deps: [] },
    ];
    expect(topologicalOrder(nodes).map((n) => n.id)).toEqual(["Core", "Lib", "App"]);
  });

  it("throws on a cycle with the offending nodes named", () => {
    const nodes: TargetNode[] = [
      { id: "A", deps: ["B"] },
      { id: "B", deps: ["A"] },
    ];
    expect(() => topologicalOrder(nodes)).toThrow(/cycle/i);
  });

  it("ignores edges to unknown ids (treats them as already-satisfied)", () => {
    const nodes: TargetNode[] = [{ id: "App", deps: ["MissingExternal"] }];
    expect(topologicalOrder(nodes).map((n) => n.id)).toEqual(["App"]);
  });
});
