export type ProbeStatus = "ok" | "warn" | "fail";

export interface ProbeResult {
  status: ProbeStatus;
  detail: string;
}

export interface Probe {
  name: string;
  check: () => Promise<ProbeResult>;
}

export interface DiagnosticEntry {
  name: string;
  status: ProbeStatus;
  detail: string;
}

export interface DiagnosticReport {
  entries: DiagnosticEntry[];
  ok: boolean;
}

export async function runDoctor(probes: Probe[]): Promise<DiagnosticReport> {
  const entries = await Promise.all(
    probes.map(async (p): Promise<DiagnosticEntry> => {
      try {
        const r = await p.check();
        return { name: p.name, status: r.status, detail: r.detail };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { name: p.name, status: "fail", detail: msg };
      }
    }),
  );
  return { entries, ok: entries.every((e) => e.status === "ok") };
}

export { defaultProbes } from "./probes.js";
