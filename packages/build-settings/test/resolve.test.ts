import { describe, expect, it } from "vitest";
import { resolveLayer } from "../src/resolve.js";

describe("resolveLayer — recursive substitution + $(inherited)", () => {
  it("resolves a flat layer with no recursion", () => {
    const out = resolveLayer({ PRODUCT_NAME: "Hello", SWIFT_VERSION: "5.0" }, {});
    expect(out).toEqual({ PRODUCT_NAME: "Hello", SWIFT_VERSION: "5.0" });
  });

  it("resolves recursive substitutions to fixpoint", () => {
    const out = resolveLayer(
      { A: "$(B)", B: "$(C)", C: "value" },
      {},
    );
    expect(out).toEqual({ A: "value", B: "value", C: "value" });
  });

  it("resolves $(inherited) against the parent layer", () => {
    const parent = { OTHER_LDFLAGS: "-framework Foo" };
    const out = resolveLayer({ OTHER_LDFLAGS: "$(inherited) -framework Bar" }, parent);
    expect(out.OTHER_LDFLAGS).toBe("-framework Foo -framework Bar");
  });

  it("resolves $(inherited) to empty when parent has no value", () => {
    const out = resolveLayer({ OTHER_LDFLAGS: "$(inherited) -lz" }, {});
    expect(out.OTHER_LDFLAGS).toBe("-lz");
  });

  it("settings from parent are inherited even if child does not mention them", () => {
    const parent = { ARCHS: "arm64", SDKROOT: "iphoneos" };
    const out = resolveLayer({ PRODUCT_NAME: "App" }, parent);
    expect(out).toEqual({ ARCHS: "arm64", SDKROOT: "iphoneos", PRODUCT_NAME: "App" });
  });

  it("child overrides parent for the same key", () => {
    const parent = { ARCHS: "armv7 arm64" };
    const out = resolveLayer({ ARCHS: "arm64" }, parent);
    expect(out.ARCHS).toBe("arm64");
  });

  it("throws on direct self-reference cycle", () => {
    expect(() => resolveLayer({ A: "$(A)" }, {})).toThrow(/cycle/i);
  });

  it("throws on indirect cycle (A→B→A)", () => {
    expect(() => resolveLayer({ A: "$(B)", B: "$(A)" }, {})).toThrow(/cycle/i);
  });
});

describe("resolveLayer — array-valued settings", () => {
  it("preserves array values verbatim when no substitution needed", () => {
    const out = resolveLayer(
      { OTHER_LDFLAGS: ["-framework", "Foo", "-framework", "Bar"] },
      {},
    );
    expect(out.OTHER_LDFLAGS).toEqual(["-framework", "Foo", "-framework", "Bar"]);
  });

  it("resolves $(inherited) in an array by prepending the parent array", () => {
    const parent = { OTHER_LDFLAGS: ["-framework", "Foo"] };
    const out = resolveLayer({ OTHER_LDFLAGS: ["$(inherited)", "-framework", "Bar"] }, parent);
    expect(out.OTHER_LDFLAGS).toEqual(["-framework", "Foo", "-framework", "Bar"]);
  });

  it("resolves $(VAR) inside an array element", () => {
    const out = resolveLayer({ X: ["$(Y)/lib", "static"], Y: "/opt" }, {});
    expect(out.X).toEqual(["/opt/lib", "static"]);
  });

  it("expands $(inherited) from a string parent as a single element in an array child", () => {
    // Inheriting from a string parent into an array child works: parent contributes its single string.
    const out = resolveLayer({ X: ["$(inherited)", "extra"] }, { X: "base" });
    expect(out.X).toEqual(["base", "extra"]);
  });

  it("expands mid-token $(inherited) from an array parent as list entries", () => {
    const parent = { LIBRARY_SEARCH_PATHS: ["/pods/A", "/pods/B"] };
    const out = resolveLayer(
      { LIBRARY_SEARCH_PATHS: ["$(SDKROOT)/usr/lib/swift$(inherited)"], SDKROOT: "/sdk" },
      parent,
    );
    expect(out.LIBRARY_SEARCH_PATHS).toEqual(["/sdk/usr/lib/swift", "/pods/A", "/pods/B"]);
  });

  it("keeps mid-token $(inherited) concatenation for scalar parents", () => {
    const out = resolveLayer({ X: ["pre$(inherited)post"] }, { X: "base" });
    expect(out.X).toEqual(["prebasepost"]);
  });

  it("keeps scalar child inheritance array-valued when parent is an array", () => {
    const parent = { LIBRARY_SEARCH_PATHS: ["/pods/A", "/pods/B"] };
    const out = resolveLayer(
      { LIBRARY_SEARCH_PATHS: "$(SDKROOT)/usr/lib/swift$(inherited)", SDKROOT: "/sdk" },
      parent,
    );
    expect(out.LIBRARY_SEARCH_PATHS).toEqual(["/sdk/usr/lib/swift", "/pods/A", "/pods/B"]);
  });
});
