import { describe, expect, it } from "vitest";
import { tokenizeXcconfigValue } from "../src/xcconfig.js";

describe("tokenizeXcconfigValue — shell-style tokenization", () => {
  describe("scalar inputs (returned as bare string)", () => {
    it("single bare token stays scalar", () => {
      expect(tokenizeXcconfigValue("HelloApp")).toBe("HelloApp");
    });

    it("bundle-id with dots stays scalar", () => {
      expect(tokenizeXcconfigValue("com.example.app")).toBe("com.example.app");
    });

    it("empty value stays empty string", () => {
      expect(tokenizeXcconfigValue("")).toBe("");
    });

    it("single token with $(VAR) substitution stays scalar", () => {
      expect(tokenizeXcconfigValue("$(SRCROOT)/Pods")).toBe("$(SRCROOT)/Pods");
    });
  });

  describe("multi-token inputs (returned as array)", () => {
    it("simple space-separated tokens", () => {
      expect(tokenizeXcconfigValue("-Onone -wmo")).toEqual(["-Onone", "-wmo"]);
    });

    it("preserves $(inherited) marker", () => {
      expect(tokenizeXcconfigValue("$(inherited) -framework Foo")).toEqual([
        "$(inherited)",
        "-framework",
        "Foo",
      ]);
    });

    it("collapses multiple whitespace to single boundary", () => {
      expect(tokenizeXcconfigValue("a  b\tc")).toEqual(["a", "b", "c"]);
    });
  });

  describe("quoted segments", () => {
    it("strips outer quotes from a single quoted token", () => {
      expect(tokenizeXcconfigValue('"$(PODS_ROOT)/Headers/Public"')).toBe(
        "$(PODS_ROOT)/Headers/Public",
      );
    });

    it("keeps spaces inside quotes as part of the token", () => {
      expect(tokenizeXcconfigValue('"path with spaces" other')).toEqual([
        "path with spaces",
        "other",
      ]);
    });

    it("array of quoted paths (the HEADER_SEARCH_PATHS case)", () => {
      expect(
        tokenizeXcconfigValue('$(inherited) "${PODS_ROOT}/Headers/Public" "${PODS_ROOT}/Headers/Public/EXConstants"'),
      ).toEqual([
        "$(inherited)",
        "${PODS_ROOT}/Headers/Public",
        "${PODS_ROOT}/Headers/Public/EXConstants",
      ]);
    });
  });

  describe("mid-token quotes (the -lFoo case)", () => {
    it("prefix + quoted-segment concatenates to a single token", () => {
      // -l"EXConstants" should become -lEXConstants (one token)
      expect(tokenizeXcconfigValue('-l"EXConstants"')).toBe("-lEXConstants");
    });

    it("OTHER_LDFLAGS-style: mix of bare and mid-quote-stripped tokens", () => {
      expect(tokenizeXcconfigValue('-ObjC -l"Foo" -l"Bar"')).toEqual([
        "-ObjC",
        "-lFoo",
        "-lBar",
      ]);
    });

    it("equals-sign attached to a quoted value", () => {
      // -fmodule-map-file="/path/to/file.modulemap" → -fmodule-map-file=/path/to/file.modulemap
      expect(
        tokenizeXcconfigValue('-fmodule-map-file="/path/to/file.modulemap"'),
      ).toBe("-fmodule-map-file=/path/to/file.modulemap");
    });

    it("multiple adjacent quoted segments concat", () => {
      expect(tokenizeXcconfigValue('pre"mid"post')).toBe("premidpost");
    });
  });

  describe("OTHER_SWIFT_FLAGS-style (the wall #3 case)", () => {
    it("tokenizes the cocoapods -Xcc -fmodule-map-file pattern", () => {
      const value = '-D COCOAPODS -Xcc -fmodule-map-file="${PODS_CONFIGURATION_BUILD_DIR}/EXConstants/EXConstants.modulemap" -Xcc -fmodule-map-file="${PODS_CONFIGURATION_BUILD_DIR}/Expo/Expo.modulemap"';
      expect(tokenizeXcconfigValue(value)).toEqual([
        "-D",
        "COCOAPODS",
        "-Xcc",
        '-fmodule-map-file=${PODS_CONFIGURATION_BUILD_DIR}/EXConstants/EXConstants.modulemap',
        "-Xcc",
        '-fmodule-map-file=${PODS_CONFIGURATION_BUILD_DIR}/Expo/Expo.modulemap',
      ]);
    });
  });
});
