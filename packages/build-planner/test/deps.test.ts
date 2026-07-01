import { describe, expect, it } from "vitest";
import { deriveDeps } from "../src/deps.js";

const TARGETS = [
  { id: "T_A", name: "Alpha" },
  { id: "T_B", name: "Beta" },
  { id: "T_C", name: "Gamma" },
];

describe("deriveDeps", () => {
  it("includes explicit PBX dependencies (ids)", () => {
    const deps = deriveDeps({
      explicitDepIds: ["T_B"],
      settings: {},
      candidateTargets: TARGETS,
    });
    expect(deps.sort()).toEqual(["T_B"]);
  });

  it("adds implicit deps from FRAMEWORK_SEARCH_PATHS PODS_CONFIGURATION_BUILD_DIR references", () => {
    const deps = deriveDeps({
      explicitDepIds: [],
      settings: {
        FRAMEWORK_SEARCH_PATHS: [
          "$(inherited)",
          "${PODS_CONFIGURATION_BUILD_DIR}/Beta",
        ],
      },
      candidateTargets: TARGETS,
    });
    expect(deps.sort()).toEqual(["T_B"]);
  });

  it("adds implicit deps from OTHER_LDFLAGS -l<Target> references", () => {
    const deps = deriveDeps({
      explicitDepIds: [],
      settings: {
        OTHER_LDFLAGS: ["-l", "Gamma"],
      },
      candidateTargets: TARGETS,
    });
    expect(deps.sort()).toEqual(["T_C"]);
  });

  it("deduplicates when explicit + heuristic both surface the same target", () => {
    const deps = deriveDeps({
      explicitDepIds: ["T_B"],
      settings: {
        FRAMEWORK_SEARCH_PATHS: ["${PODS_CONFIGURATION_BUILD_DIR}/Beta"],
      },
      candidateTargets: TARGETS,
    });
    expect(deps.sort()).toEqual(["T_B"]);
  });

  it("silently drops references to names that don't match any candidate target", () => {
    const deps = deriveDeps({
      explicitDepIds: [],
      settings: {
        FRAMEWORK_SEARCH_PATHS: ["${PODS_CONFIGURATION_BUILD_DIR}/Nonexistent"],
      },
      candidateTargets: TARGETS,
    });
    expect(deps).toEqual([]);
  });

  it("handles scalar string settings (not just arrays)", () => {
    const deps = deriveDeps({
      explicitDepIds: [],
      settings: {
        FRAMEWORK_SEARCH_PATHS: "${PODS_CONFIGURATION_BUILD_DIR}/Beta",
      },
      candidateTargets: TARGETS,
    });
    expect(deps.sort()).toEqual(["T_B"]);
  });

  it("returns a NEW array (does not share storage with explicitDepIds)", () => {
    const explicit = ["T_B"];
    const deps = deriveDeps({
      explicitDepIds: explicit,
      settings: {},
      candidateTargets: TARGETS,
    });
    expect(deps).not.toBe(explicit);
  });
});
