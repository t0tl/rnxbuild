import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleApp } from "../src/bundle.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const here = dirname(fileURLToPath(import.meta.url));
const goldenFileList = resolve(
  here,
  "../../../fixtures/01-bare/expected/app-build/01bare.app.file-list.txt",
);

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("app-bundler goldens parity", () => {
  it("produces root bundle entries present in fixture-01-bare's golden file list", async () => {
    const goldenContent = await readFile(goldenFileList, "utf8");
    const goldenFiles = goldenContent
      .split("\n")
      .filter(Boolean)
      .map((path) => path.replace(/^01bare\.app\//, ""));

    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-parity-"));
    const binary = join(workdir, "01bare");
    const car = join(workdir, "Assets.car");
    const privacy = join(workdir, "PrivacyInfo.xcprivacy");
    const framework = join(workdir, "React.framework");
    await writeFile(binary, "fake");
    await writeFile(car, "fake car");
    await writeFile(privacy, "<plist/>");
    await mkdir(framework, { recursive: true });
    await writeFile(join(framework, "React"), "fake");

    const result = await bundleApp({
      outputAppPath: join(workdir, "01bare.app"),
      mainBinaryPath: binary,
      settings: { EXECUTABLE_NAME: "01bare", PRODUCT_NAME: "01-bare" },
      context: CTX,
      productModuleName: "01bare",
      sdkPath: "/abs/iPhoneOS.sdk",
      assetCatalogPath: car,
      privacyManifestPath: privacy,
      embeddedFrameworks: [framework],
    });

    for (const file of ["01bare", "Info.plist", "PkgInfo", "Assets.car", "PrivacyInfo.xcprivacy"]) {
      expect(result.filesWritten, `missing root file: ${file}`).toContain(file);
      expect(goldenFiles, `golden does not contain ${file}`).toContain(file);
    }
    expect(result.filesWritten).toContain("Frameworks/React.framework");
  });
});
