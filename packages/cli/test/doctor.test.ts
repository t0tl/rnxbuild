import { describe, expect, it } from "vitest";
import { formatDoctorReport } from "../src/doctor.js";
import type { DiagnosticReport } from "@rnxbuild/diagnostic";

describe("formatDoctorReport", () => {
  it("renders an ok/warn/fail table with all entries", () => {
    const report: DiagnosticReport = {
      ok: false,
      entries: [
        { name: "Node", status: "ok", detail: "v22.0.0" },
        { name: "iOS SDK", status: "warn", detail: "not extracted" },
        { name: "xtool", status: "fail", detail: "missing" },
      ],
    };
    const out = formatDoctorReport(report);
    expect(out).toContain("Node");
    expect(out).toContain("v22.0.0");
    expect(out).toContain("iOS SDK");
    expect(out).toContain("not extracted");
    expect(out).toContain("xtool");
    expect(out).toContain("missing");
  });

  it("ends with a single-line summary indicating not ok", () => {
    const report: DiagnosticReport = {
      ok: false,
      entries: [{ name: "X", status: "fail", detail: "" }],
    };
    const out = formatDoctorReport(report);
    expect(out).toMatch(/1 issue|not ready/i);
  });

  it("ends with 'all checks passed' when ok", () => {
    const report: DiagnosticReport = {
      ok: true,
      entries: [{ name: "X", status: "ok", detail: "" }],
    };
    const out = formatDoctorReport(report);
    expect(out).toMatch(/all checks passed/i);
  });
});
