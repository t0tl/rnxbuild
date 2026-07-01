import { describe, expect, it } from "vitest";
import { substituteVariables } from "../src/substitute.js";

describe("substituteVariables — single pass", () => {
  it("replaces $(VAR) with its value", () => {
    expect(substituteVariables("foo $(BAR) baz", { BAR: "qux" })).toBe("foo qux baz");
  });

  it("replaces ${VAR} with its value (alternate syntax)", () => {
    expect(substituteVariables("foo ${BAR} baz", { BAR: "qux" })).toBe("foo qux baz");
  });

  it("leaves $(MISSING) as empty string when var unknown", () => {
    expect(substituteVariables("a $(MISSING) b", {})).toBe("a  b");
  });

  it("does NOT recurse — $(A) where A=$(B) yields literal $(B)", () => {
    expect(substituteVariables("$(A)", { A: "$(B)", B: "actual" })).toBe("$(B)");
  });

  it("handles multiple substitutions in one string", () => {
    expect(substituteVariables("$(A)/$(B)", { A: "src", B: "main" })).toBe("src/main");
  });

  it("preserves $(inherited) verbatim (resolved by the cascade, not here)", () => {
    expect(substituteVariables("$(inherited) $(EXTRA)", { EXTRA: "x" })).toBe("$(inherited) x");
  });

  it("supports nested-brace forms like $(VAR:operator) by treating as opaque key", () => {
    expect(substituteVariables("$(VAR:lower)", { VAR: "abc" })).toBe("");
  });
});
