import { describe, expect, it } from "vitest";
import { partitionSourcesByLang } from "../src/partition.js";

describe("partitionSourcesByLang", () => {
  it("partitions sources by file extension", () => {
    const result = partitionSourcesByLang([
      "/x/foo.swift",
      "/x/bar.m",
      "/x/baz.mm",
      "/x/qux.c",
      "/x/quux.cpp",
      "/x/corge.cc",
      "/x/grault.cxx",
    ]);
    expect(result.swift).toEqual(["/x/foo.swift"]);
    expect(result.objc).toEqual(["/x/bar.m"]);
    expect(result.objcpp).toEqual(["/x/baz.mm"]);
    expect(result.c).toEqual(["/x/qux.c"]);
    expect(result.cpp).toEqual(["/x/quux.cpp", "/x/corge.cc", "/x/grault.cxx"]);
  });

  it("ignores files with unrecognized extensions", () => {
    const result = partitionSourcesByLang([
      "/x/foo.swift",
      "/x/README.md",
      "/x/image.png",
      "/x/no-ext",
    ]);
    expect(result.swift).toEqual(["/x/foo.swift"]);
    expect(result.objc).toEqual([]);
    expect(result.objcpp).toEqual([]);
    expect(result.c).toEqual([]);
    expect(result.cpp).toEqual([]);
  });

  it("returns all-empty arrays for an empty input", () => {
    const result = partitionSourcesByLang([]);
    expect(result).toEqual({ swift: [], objc: [], objcpp: [], c: [], cpp: [] });
  });

  it("is case-insensitive for the extension", () => {
    const result = partitionSourcesByLang(["/x/Foo.Swift", "/x/Bar.M"]);
    expect(result.swift).toEqual(["/x/Foo.Swift"]);
    expect(result.objc).toEqual(["/x/Bar.M"]);
  });

  it("preserves input order within each language bucket", () => {
    const result = partitionSourcesByLang(["/x/b.m", "/x/a.m", "/x/c.m"]);
    expect(result.objc).toEqual(["/x/b.m", "/x/a.m", "/x/c.m"]);
  });
});
