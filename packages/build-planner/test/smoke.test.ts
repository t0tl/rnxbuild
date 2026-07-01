import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("@rnxbuild/build-planner smoke", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@rnxbuild/build-planner");
  });
});
