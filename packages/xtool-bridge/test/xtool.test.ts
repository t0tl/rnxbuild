import { describe, expect, it, vi } from "vitest";
import { createXtoolBridge } from "../src/index.js";

describe("createXtoolBridge", () => {
  it("uses the injected runner — no real subprocess in tests", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "xtool 1.17.0\n", exitCode: 0 });
    const xtool = createXtoolBridge({ binaryPath: "/usr/local/bin/xtool", run: runner });
    expect(await xtool.version()).toBe("1.17.0");
    expect(runner).toHaveBeenCalledWith("/usr/local/bin/xtool", ["--version"]);
  });

  it("isAvailable returns true on exit-code 0", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "xtool 1.17.0\n", exitCode: 0 });
    const xtool = createXtoolBridge({ binaryPath: "/usr/local/bin/xtool", run: runner });
    expect(await xtool.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when the runner throws (ENOENT-like)", async () => {
    const runner = vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }));
    const xtool = createXtoolBridge({ binaryPath: "/nonexistent", run: runner });
    expect(await xtool.isAvailable()).toBe(false);
  });

  it("version throws if stdout doesn't look like a version", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "weird output\n", exitCode: 0 });
    const xtool = createXtoolBridge({ binaryPath: "/usr/local/bin/xtool", run: runner });
    await expect(xtool.version()).rejects.toThrow(/could not parse/i);
  });
});
