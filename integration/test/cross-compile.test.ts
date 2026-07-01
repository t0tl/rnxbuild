import { describe, it, expect, beforeAll } from "vitest";
import { execa } from "execa";
import { mkdtemp, writeFile, mkdir, readFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../fixtures/01-bare");
const helloXtoolFixture = resolve(here, "fixtures/helloxtool-app");

// --- Helpers ---

let SWIFT_PATH: string | null = null;
let HAS_IOS_SWIFT_SDK = false;

beforeAll(async () => {
  SWIFT_PATH = await findSwift();
  if (SWIFT_PATH) HAS_IOS_SWIFT_SDK = await checkIosSdk(SWIFT_PATH);
});

/** Find an absolute path to a `swift` binary, preferring swiftly's location. */
async function findSwift(): Promise<string | null> {
  const candidates = [
    `${process.env.HOME ?? ""}/.local/share/swiftly/bin/swift`,
    "/usr/local/bin/swift",
    "/usr/bin/swift",
  ];
  for (const c of candidates) {
    try {
      await stat(c);
      return c;
    } catch {
      /* not present */
    }
  }
  // Last resort: `which swift` from a shell that may have it
  try {
    const r = await execa("which", ["swift"], { reject: false });
    if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {
    /* */
  }
  return null;
}

async function checkIosSdk(swift: string): Promise<boolean> {
  try {
    const r = await execa(swift, ["sdk", "list"], { reject: false });
    return r.exitCode === 0 && String(r.stdout).includes("darwin");
  } catch {
    return false;
  }
}

/** Returns true iff `path` is a 64-bit arm64 Mach-O object file. */
async function isMachOArm64(path: string): Promise<boolean> {
  // Mach-O magic: 0xCFFAEDFE (LE) for MH_MAGIC_64
  // After magic (4 bytes): cputype (4 bytes), where 0x0100000C = CPU_TYPE_ARM64
  const buf = await readFile(path);
  if (buf.length < 12) return false;
  const magic = buf.readUInt32LE(0);
  if (magic !== 0xfeedfacf) return false; // 0xCFFAEDFE on disk = 0xFEEDFACF when read as LE on x86
  const cputype = buf.readUInt32LE(4);
  return cputype === 0x0100000c; // ARM64
}

/** Recursively find every `.o` file under `dir`. */
async function findObjects(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(".o")) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/** Write a SwiftPM library package to `dir` with the given Package.swift + sources. */
async function writePackage(
  dir: string,
  _name: string,
  packageSwift: string,
  sources: Record<string, string>,
): Promise<void> {
  await writeFile(join(dir, "Package.swift"), packageSwift, "utf8");
  for (const [rel, content] of Object.entries(sources)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

// --- Tests ---

describe("Linux→iOS Swift cross-compilation", () => {
  it("swift sdk list shows the darwin iOS SDK", { timeout: 20_000 }, async (testCtx) => {
    if (!HAS_IOS_SWIFT_SDK) {
      testCtx.skip();
      return;
    }
    const r = await execa(SWIFT_PATH!, ["sdk", "list"], { reject: false });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("darwin");
  });

  it(
    "cross-compiles a Foundation hello-world to arm64 Mach-O",
    { timeout: 180_000 },
    async (testCtx) => {
      if (!HAS_IOS_SWIFT_SDK) {
        testCtx.skip();
        return;
      }
      const dir = await mkdtemp(join(tmpdir(), "rnxb-cc-foundation-"));
      await writePackage(
        dir,
        "Hello",
        `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "Hello",
  platforms: [.iOS(.v17)],
  products: [.library(name: "Hello", targets: ["Hello"])],
  targets: [.target(name: "Hello")]
)
`,
        {
          "Sources/Hello/Hello.swift": `import Foundation\n\npublic func now() -> Date { Date() }\n`,
        },
      );

      const r = await execa(SWIFT_PATH!, ["build", "--swift-sdk", "arm64-apple-ios"], {
        cwd: dir,
        reject: false,
      });
      if (r.exitCode !== 0) {
        // Provide useful debugging if compile failed
        console.error("swift build failed:\n" + String(r.stderr));
      }
      expect(r.exitCode).toBe(0);

      const objs = await findObjects(join(dir, ".build/arm64-apple-ios"));
      expect(objs.length).toBeGreaterThan(0);
      for (const obj of objs) {
        expect(await isMachOArm64(obj), `${obj} is not Mach-O arm64`).toBe(true);
      }
    },
  );

  it(
    "cross-compiles a SwiftUI hello-world to arm64 Mach-O",
    { timeout: 180_000 },
    async (testCtx) => {
      if (!HAS_IOS_SWIFT_SDK) {
        testCtx.skip();
        return;
      }
      const dir = await mkdtemp(join(tmpdir(), "rnxb-cc-swiftui-"));
      await writePackage(
        dir,
        "Greet",
        `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "Greet",
  platforms: [.iOS(.v17)],
  products: [.library(name: "Greet", targets: ["Greet"])],
  targets: [.target(name: "Greet")]
)
`,
        {
          "Sources/Greet/Greet.swift": `import SwiftUI

public struct Greet: View {
  public init() {}
  public var body: some View {
    Text("Hello from rnxbuild")
      .bold()
      .foregroundColor(.purple)
  }
}
`,
        },
      );

      const r = await execa(SWIFT_PATH!, ["build", "--swift-sdk", "arm64-apple-ios"], {
        cwd: dir,
        reject: false,
      });
      if (r.exitCode !== 0) console.error("swift build failed:\n" + String(r.stderr));
      expect(r.exitCode).toBe(0);

      const objs = await findObjects(join(dir, ".build/arm64-apple-ios"));
      expect(objs.length).toBeGreaterThan(0);
      for (const obj of objs) {
        expect(await isMachOArm64(obj), `${obj} is not Mach-O arm64`).toBe(true);
      }
    },
  );

  it(
    "cross-compiles the committed HelloXtool fixture (@main App entrypoint)",
    { timeout: 180_000 },
    async (testCtx) => {
      if (!HAS_IOS_SWIFT_SDK) {
        testCtx.skip();
        return;
      }

      // Build the committed fixture in place. `.build/` outputs are gitignored
      // at the repo root so they don't leak into source-control state.
      const r = await execa(SWIFT_PATH!, ["build", "--swift-sdk", "arm64-apple-ios"], {
        cwd: helloXtoolFixture,
        reject: false,
      });
      if (r.exitCode !== 0) console.error("swift build failed:\n" + String(r.stderr));
      expect(r.exitCode).toBe(0);

      const objs = await findObjects(join(helloXtoolFixture, ".build/arm64-apple-ios"));
      expect(objs.length).toBeGreaterThan(0);
      for (const obj of objs) {
        expect(await isMachOArm64(obj), `${obj} is not Mach-O arm64`).toBe(true);
      }
    },
  );

  it(
    "real Expo Pod source fails informatively (characterization)",
    { timeout: 180_000 },
    async (testCtx) => {
      if (!HAS_IOS_SWIFT_SDK) {
        testCtx.skip();
        return;
      }

      // Pick a real-Expo source file that imports framework-level dependencies
      // (React, ExpoModulesJSI). AppContext.swift is the canonical example: its
      // first two lines are `import React` and `import ExpoModulesJSI`, neither
      // of which resolves without framework search paths / module maps.
      //
      // (Note: we previously tried Utilities/Mutex.swift, but it only imports
      // Foundation and compiles cleanly against the stock iOS SDK. AppContext is
      // the more honest stand-in for the wall Plan 2 needs to break through.)
      const expoSource = resolve(
        fixtureRoot,
        "node_modules/expo-modules-core/ios/Core/AppContext.swift",
      );
      try {
        await stat(expoSource);
      } catch {
        testCtx.skip(); // fixture's node_modules not present (CI without npm install)
        return;
      }

      // Wrap the single file in a tiny SwiftPM package and try to build it.
      const dir = await mkdtemp(join(tmpdir(), "rnxb-cc-expoappctx-"));
      await writePackage(
        dir,
        "Probe",
        `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "Probe",
  platforms: [.iOS(.v17)],
  products: [.library(name: "Probe", targets: ["Probe"])],
  targets: [.target(name: "Probe")]
)
`,
        {
          "Sources/Probe/AppContext.swift": await readFile(expoSource, "utf8"),
        },
      );

      const r = await execa(SWIFT_PATH!, ["build", "--swift-sdk", "arm64-apple-ios"], {
        cwd: dir,
        reject: false,
      });

      // This SHOULD fail. If it succeeds, the characterization is wrong and we need
      // to know about it (Plan 2 just got easier — or the test is broken).
      if (r.exitCode === 0) {
        throw new Error(
          "Real Expo Pod source unexpectedly compiled cleanly. Either: " +
            "(a) Mutex.swift turned out standalone enough not to need framework search paths " +
            "(unlikely but check), or (b) this characterization test no longer reflects reality. " +
            "Investigate before changing the assertion.",
        );
      }

      // Expect a recognizable framework/import-related error. We accept any of several
      // phrasings since the Swift compiler varies the wording across versions.
      const combined = (String(r.stderr) + String(r.stdout)).toLowerCase();
      const hasRecognizableError =
        combined.includes("no such module") ||
        combined.includes("cannot find") ||
        combined.includes("unable to") ||
        combined.includes("framework not found") ||
        combined.includes("could not build");
      expect(
        hasRecognizableError,
        "expected a framework/import-related error, got:\n" + combined.slice(0, 800),
      ).toBe(true);
    },
  );
});
