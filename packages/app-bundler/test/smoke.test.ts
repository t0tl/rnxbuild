import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("@rnxbuild/app-bundler smoke", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@rnxbuild/app-bundler");
  });
});
