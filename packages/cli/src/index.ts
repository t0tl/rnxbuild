import { Command } from "commander";
import { executeDoctor, formatDoctorReport } from "./doctor.js";

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program.name("rnxbuild").description("Linux-native build tool for React Native + Expo iOS apps");

  program
    .command("doctor")
    .description("Diagnose the local toolchain.")
    .action(async () => {
      const report = await executeDoctor();
      process.stdout.write(formatDoctorReport(report) + "\n");
      process.exit(report.ok ? 0 : 1);
    });

  program
    .command("build <project>")
    .description("Build a .app from an Expo project (not yet implemented in Plan 1).")
    .action(() => {
      process.stderr.write("rnxbuild build: not implemented in Plan 1 — see Plan 2.\n");
      process.exit(2);
    });

  program
    .command("install <project>")
    .description("Build + sign + install on a tethered iPhone (not yet implemented in Plan 1).")
    .action(() => {
      process.stderr.write("rnxbuild install: not implemented in Plan 1 — see Plan 2.\n");
      process.exit(2);
    });

  await program.parseAsync(argv);
  return 0;
}
