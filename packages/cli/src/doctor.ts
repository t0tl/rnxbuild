import { defaultProbes, runDoctor, type DiagnosticReport } from "@rnxbuild/diagnostic";
import kleur from "kleur";

export async function executeDoctor(): Promise<DiagnosticReport> {
  return runDoctor(defaultProbes());
}

export function formatDoctorReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  const nameWidth = Math.max(...report.entries.map((e) => e.name.length), 4) + 2;
  lines.push("");
  for (const entry of report.entries) {
    const badge = ({ ok: kleur.green("✓"), warn: kleur.yellow("!"), fail: kleur.red("✗") } as const)[
      entry.status
    ];
    lines.push(`  ${badge}  ${entry.name.padEnd(nameWidth)}${entry.detail}`);
  }
  lines.push("");
  if (report.ok) {
    lines.push(kleur.green("  All checks passed."));
  } else {
    const failing = report.entries.filter((e) => e.status !== "ok");
    lines.push(kleur.red(`  ${failing.length} issue(s) — system not ready for full builds.`));
    lines.push("  (Plan-1 features that don't need the full toolchain still work.)");
  }
  return lines.join("\n");
}
