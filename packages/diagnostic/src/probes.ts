import { execa } from "execa";
import { createXtoolBridge } from "@rnxbuild/xtool-bridge";
import type { Probe } from "./index.js";

/**
 * The default set of probes — covers everything `rnxbuild` will need at runtime.
 * Each probe is fully self-contained; tests pass their own probe lists.
 */
export function defaultProbes(): Probe[] {
  return [
    {
      name: "Node",
      check: async () => ({ status: "ok", detail: process.version }),
    },
    {
      name: "Swift",
      check: async () => {
        try {
          const r = await execa("swift", ["--version"], { reject: false });
          const line = String(r.stdout).split("\n")[0] ?? "";
          if (r.exitCode === 0 && /Swift version/.test(line)) {
            return { status: "ok", detail: line.trim() };
          }
          return { status: "fail", detail: `swift --version exited ${r.exitCode ?? "?"}` };
        } catch {
          return { status: "fail", detail: "swift not on PATH (install via swiftly)" };
        }
      },
    },
    {
      name: "xtool",
      check: async () => {
        const home = process.env.HOME ?? "";
        const xtool = createXtoolBridge({ binaryPath: `${home}/.local/bin/xtool` });
        if (!(await xtool.isAvailable())) {
          return {
            status: "fail",
            detail: "xtool not found at ~/.local/bin/xtool (download AppImage from github.com/xtool-org/xtool)",
          };
        }
        return { status: "ok", detail: await xtool.version() };
      },
    },
    {
      name: "iOS Swift SDK (xtool setup)",
      check: async () => {
        try {
          const r = await execa("swift", ["sdk", "list"], { reject: false });
          if (String(r.stdout).includes("darwin")) return { status: "ok", detail: "darwin SDK installed" };
          return {
            status: "warn",
            detail: "no Darwin SDK; run `xtool setup` and feed it your Xcode.xip",
          };
        } catch {
          return { status: "warn", detail: "swift not available; can't check SDKs" };
        }
      },
    },
    {
      name: "libimobiledevice",
      check: async () => {
        try {
          const r = await execa("ideviceinfo", ["--version"], { reject: false });
          if (r.exitCode === 0) return { status: "ok", detail: String(r.stdout).trim().split("\n")[0] ?? "installed" };
          return { status: "warn", detail: "ideviceinfo present but version probe failed" };
        } catch {
          return {
            status: "warn",
            detail: "not installed (apt: usbmuxd libimobiledevice-utils); needed for device install",
          };
        }
      },
    },
    {
      name: "CocoaPods",
      check: async () => {
        try {
          const r = await execa("pod", ["--version"], { reject: false });
          if (r.exitCode === 0) return { status: "ok", detail: String(r.stdout).trim() };
          return { status: "warn", detail: "pod present but exited non-zero" };
        } catch {
          return { status: "warn", detail: "not installed (gem install cocoapods)" };
        }
      },
    },
  ];
}
