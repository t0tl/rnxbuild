import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleApp } from "../src/bundle.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("bundleApp", () => {
  it("creates <outputAppPath>/, copies main binary, writes Info.plist and PkgInfo", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-"));
    const binaryPath = await makeBinary(workdir, "TestApp");
    const appPath = join(workdir, "TestApp.app");

    const result = await bundleApp({
      outputAppPath: appPath,
      mainBinaryPath: binaryPath,
      settings: { PRODUCT_BUNDLE_IDENTIFIER: "com.test.app", PRODUCT_NAME: "TestApp" },
      context: CTX,
      productModuleName: "TestApp",
      sdkPath: "/abs/iPhoneOS.sdk",
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(appPath, "TestApp"), "utf8")).toBe("fake binary");
    expect((await readFile(join(appPath, "Info.plist"))).subarray(0, 6).toString()).toBe("bplist");
    expect(await readFile(join(appPath, "PkgInfo"), "utf8")).toBe("APPL????");
  });

  it("copies Assets.car when provided", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-assets-"));
    const carPath = join(workdir, "Assets.car");
    await writeFile(carPath, Buffer.from([0xca, 0xfe]));

    await bundleApp(await baseInput(workdir, { assetCatalogPath: carPath }));

    const copied = await readFile(join(workdir, "App.app", "Assets.car"));
    expect(copied.subarray(0, 2).toString("hex")).toBe("cafe");
  });

  it("copies storyboards as .storyboardc directories", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-sb-"));
    const storyboard = join(workdir, "SplashScreen.storyboardc");
    await mkdir(storyboard, { recursive: true });
    await writeFile(join(storyboard, "Info.plist"), "stub");

    await bundleApp(await baseInput(workdir, { storyboards: [storyboard] }));

    expect(
      await readFile(join(workdir, "App.app", "SplashScreen.storyboardc", "Info.plist"), "utf8"),
    ).toBe("stub");
  });

  it("copies resource bundles", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-bun-"));
    const bundle = join(workdir, "Foo_privacy.bundle");
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, "PrivacyInfo.xcprivacy"), "stub");

    await bundleApp(await baseInput(workdir, { resourceBundles: [bundle] }));

    const copied = await stat(join(workdir, "App.app", "Foo_privacy.bundle", "PrivacyInfo.xcprivacy"));
    expect(copied.size).toBeGreaterThan(0);
  });

  it("copies embedded frameworks into <App.app>/Frameworks/", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-fw-"));
    const framework = join(workdir, "MyFw.framework");
    await mkdir(framework, { recursive: true });
    await writeFile(join(framework, "MyFw"), "fw binary");
    await writeFile(join(framework, "Info.plist"), "fw plist");

    await bundleApp(await baseInput(workdir, { embeddedFrameworks: [framework] }));

    expect(await readFile(join(workdir, "App.app", "Frameworks", "MyFw.framework", "MyFw"), "utf8")).toBe(
      "fw binary",
    );
  });

  it("copies loose resources to the app root", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-res-"));
    const resource = join(workdir, "config.json");
    await writeFile(resource, "{}");

    await bundleApp(await baseInput(workdir, { resources: [resource] }));

    expect(await readFile(join(workdir, "App.app", "config.json"), "utf8")).toBe("{}");
  });

  it("copies PrivacyInfo.xcprivacy to the app root", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-priv-"));
    const privacy = join(workdir, "PrivacyInfo.xcprivacy");
    await writeFile(privacy, "<plist/>");

    await bundleApp(await baseInput(workdir, { privacyManifestPath: privacy }));

    expect(await readFile(join(workdir, "App.app", "PrivacyInfo.xcprivacy"), "utf8")).toBe("<plist/>");
  });

  it("returns BundleResult with filesWritten relative paths", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "rnxb-bundler-result-"));

    const result = await bundleApp(await baseInput(workdir));

    expect(result.filesWritten).toContain("App");
    expect(result.filesWritten).toContain("Info.plist");
    expect(result.filesWritten).toContain("PkgInfo");
  });
});

async function makeBinary(dir: string, name: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, "fake binary", "utf8");
  return path;
}

async function baseInput(
  workdir: string,
  overrides: Partial<Parameters<typeof bundleApp>[0]> = {},
): Promise<Parameters<typeof bundleApp>[0]> {
  const binaryPath = await makeBinary(workdir, "App");
  return {
    outputAppPath: join(workdir, "App.app"),
    mainBinaryPath: binaryPath,
    settings: {},
    context: CTX,
    productModuleName: "App",
    sdkPath: "/sdk",
    ...overrides,
  };
}
