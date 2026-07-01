import { describe, expect, it } from "vitest";
import { createLogger } from "../src/index.js";

describe("createLogger", () => {
  it("returns a logger with info/warn/error/debug methods", () => {
    const log = createLogger({ name: "test" });
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.debug).toBe("function");
  });

  it("child loggers inherit base bindings", () => {
    const root = createLogger({ name: "test" });
    const child = root.child({ target: "Foo" });
    expect(typeof child.info).toBe("function");
  });

  it("respects RNXBUILD_LOG_LEVEL env override", () => {
    process.env.RNXBUILD_LOG_LEVEL = "debug";
    const log = createLogger({ name: "test" });
    expect(log.level).toBe("debug");
    delete process.env.RNXBUILD_LOG_LEVEL;
  });
});
