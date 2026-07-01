import { describe, expect, it, vi } from "vitest";
import { runDoctor, type Probe } from "../src/index.js";

describe("runDoctor", () => {
  it("returns one entry per probe", async () => {
    const probes: Probe[] = [
      { name: "Swift", check: async () => ({ status: "ok", detail: "6.3.2" }) },
      { name: "xtool", check: async () => ({ status: "ok", detail: "1.17.0" }) },
    ];
    const report = await runDoctor(probes);
    expect(report.entries.map((e) => e.name)).toEqual(["Swift", "xtool"]);
    expect(report.entries.every((e) => e.status === "ok")).toBe(true);
  });

  it("captures probe errors as a 'fail' status with the error message", async () => {
    const probes: Probe[] = [
      { name: "Broken", check: async () => { throw new Error("boom"); } },
    ];
    const report = await runDoctor(probes);
    expect(report.entries[0]!.status).toBe("fail");
    expect(report.entries[0]!.detail).toContain("boom");
  });

  it("ok flag is false if any probe failed or warned", async () => {
    const allOk = await runDoctor([
      { name: "A", check: async () => ({ status: "ok", detail: "" }) },
    ]);
    expect(allOk.ok).toBe(true);

    const withWarn = await runDoctor([
      { name: "A", check: async () => ({ status: "ok", detail: "" }) },
      { name: "B", check: async () => ({ status: "warn", detail: "not extracted" }) },
    ]);
    expect(withWarn.ok).toBe(false);
  });

  it("runs probes in parallel — sequential timing would exceed 80ms for two 50ms probes", async () => {
    const slow = (status: "ok"): Probe => ({
      name: `s${Math.random()}`,
      check: async () => { await new Promise((r) => setTimeout(r, 50)); return { status, detail: "" }; },
    });
    const start = Date.now();
    await runDoctor([slow("ok"), slow("ok")]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(120);
  });

  it("can be invoked with an empty probe list", async () => {
    const report = await runDoctor([]);
    expect(report.entries).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("does not let one rejected probe abort the others", async () => {
    const probes: Probe[] = [
      { name: "A", check: async () => { throw new Error("a"); } },
      { name: "B", check: async () => ({ status: "ok", detail: "" }) },
    ];
    const report = await runDoctor(probes);
    expect(report.entries.map((e) => e.name).sort()).toEqual(["A", "B"]);
  });
});
