import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseXcconfig } from "../src/xcconfig.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("parseXcconfig", () => {
  it("parses unconditional settings", async () => {
    const c = await parseXcconfig(resolve(here, "fixtures/Sample.xcconfig"));
    expect(c.settings.find((s) => s.key === "PRODUCT_NAME" && s.condition === null)?.value).toBe(
      "HelloApp",
    );
    expect(c.settings.find((s) => s.key === "SWIFT_VERSION" && s.condition === null)?.value).toBe(
      "5.0",
    );
  });

  it("preserves conditional settings as separate entries", async () => {
    const c = await parseXcconfig(resolve(here, "fixtures/Sample.xcconfig"));
    const ldFlags = c.settings.filter((s) => s.key === "OTHER_LDFLAGS");
    expect(ldFlags).toHaveLength(2);
    expect(ldFlags.find((s) => s.condition === "sdk=iphoneos*")?.value).toEqual([
      "-framework",
      "UIKit",
    ]);
    expect(ldFlags.find((s) => s.condition === "sdk=iphonesimulator*")?.value).toEqual([
      "-framework",
      "UIKit",
      "-framework",
      "XCTest",
    ]);
  });

  it("preserves $(inherited) and $(VAR) substitutions verbatim", async () => {
    const c = await parseXcconfig(resolve(here, "fixtures/Sample.xcconfig"));
    expect(c.settings.find((s) => s.key === "HEADER_SEARCH_PATHS")?.value).toEqual([
      "$(inherited)",
      "$(SRCROOT)/include",
    ]);
  });

  it("records includes in order, resolved relative to the file", async () => {
    const c = await parseXcconfig(resolve(here, "fixtures/Sample.xcconfig"));
    expect(c.includes).toEqual([resolve(here, "fixtures/Base.xcconfig")]);
  });

  it("strips trailing // comments from values", async () => {
    const c = await parseXcconfig(resolve(here, "fixtures/Sample.xcconfig"));
    expect(c.settings.find((s) => s.key === "GCC_PREPROCESSOR_DEFINITIONS")?.value).toBe(
      "DEBUG=1",
    );
  });

  it("skips blank lines and full-line comments", async () => {
    const c = await parseXcconfig(resolve(here, "fixtures/Base.xcconfig"));
    expect(c.settings.map((s) => s.key)).toEqual([
      "CLANG_CXX_LANGUAGE_STANDARD",
      "GCC_C_LANGUAGE_STANDARD",
    ]);
  });
});
