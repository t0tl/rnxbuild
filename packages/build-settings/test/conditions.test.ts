import { describe, expect, it } from "vitest";
import { selectConditional, type BuildContext } from "../src/conditions.js";

const ctx: BuildContext = {
  sdk: "iphoneos17.0",
  arch: "arm64",
  config: "Debug",
};

describe("selectConditional", () => {
  it("returns null condition entries verbatim", () => {
    expect(selectConditional("OTHER_LDFLAGS", null, ctx)).toBe(true);
  });

  it("matches exact sdk", () => {
    expect(selectConditional("X", "sdk=iphoneos17.0", ctx)).toBe(true);
  });

  it("matches glob sdk (iphoneos*)", () => {
    expect(selectConditional("X", "sdk=iphoneos*", ctx)).toBe(true);
  });

  it("rejects non-matching sdk", () => {
    expect(selectConditional("X", "sdk=iphonesimulator*", ctx)).toBe(false);
  });

  it("matches arch=arm64", () => {
    expect(selectConditional("X", "arch=arm64", ctx)).toBe(true);
  });

  it("matches arch=*", () => {
    expect(selectConditional("X", "arch=*", ctx)).toBe(true);
  });

  it("matches config=Debug", () => {
    expect(selectConditional("X", "config=Debug", ctx)).toBe(true);
  });

  it("rejects mismatched config", () => {
    expect(selectConditional("X", "config=Release", ctx)).toBe(false);
  });

  it("AND-combines multiple selectors via comma", () => {
    expect(selectConditional("X", "sdk=iphoneos*,arch=arm64", ctx)).toBe(true);
    expect(selectConditional("X", "sdk=iphoneos*,arch=x86_64", ctx)).toBe(false);
  });

  it("returns false for unknown selector key", () => {
    expect(selectConditional("X", "wat=foo", ctx)).toBe(false);
  });
});
