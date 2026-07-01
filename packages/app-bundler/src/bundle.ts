import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BuildContext, SettingsDict, SettingValue } from "@rnxbuild/build-settings";
import { buildPlist, type PlistValue } from "@rnxbuild/plist";
import { synthesizeInfoPlist } from "./infoplist.js";

export interface BundleAppInput {
  /** Absolute path where <AppName>.app/ should be created. */
  outputAppPath: string;
  /** Absolute path to the linked Mach-O executable. */
  mainBinaryPath: string;
  /** Fully-resolved Xcode build settings for the app target. */
  settings: SettingsDict;
  /** Build context. */
  context: BuildContext;
  /** Module / product name. */
  productModuleName: string;
  /** Absolute SDK path for Info.plist derivations. */
  sdkPath: string;
  resources?: string[];
  assetCatalogPath?: string;
  storyboards?: string[];
  resourceBundles?: string[];
  embeddedFrameworks?: string[];
  privacyManifestPath?: string;
  userInfoPlist?: Record<string, PlistValue>;
}

export interface BundleResult {
  ok: boolean;
  appPath: string;
  /** Paths written, relative to appPath. */
  filesWritten: string[];
}

export async function bundleApp(input: BundleAppInput): Promise<BundleResult> {
  const filesWritten: string[] = [];
  await mkdir(input.outputAppPath, { recursive: true });

  const executableName = scalar(input.settings.EXECUTABLE_NAME) ?? input.productModuleName;
  await copyFile(input.mainBinaryPath, join(input.outputAppPath, executableName));
  filesWritten.push(executableName);

  const plist = synthesizeInfoPlist({
    settings: input.settings,
    context: input.context,
    productModuleName: input.productModuleName,
    sdkPath: input.sdkPath,
    userInfoPlist: input.userInfoPlist,
  });
  const plistBytes = await buildPlist(plist, { format: "binary" });
  await writeFile(join(input.outputAppPath, "Info.plist"), plistBytes);
  filesWritten.push("Info.plist");

  await writeFile(join(input.outputAppPath, "PkgInfo"), "APPL????", "utf8");
  filesWritten.push("PkgInfo");

  if (input.assetCatalogPath) {
    await copyFile(input.assetCatalogPath, join(input.outputAppPath, "Assets.car"));
    filesWritten.push("Assets.car");
  }

  for (const storyboard of input.storyboards ?? []) {
    const name = basename(storyboard);
    await cp(storyboard, join(input.outputAppPath, name), { recursive: true });
    filesWritten.push(name);
  }

  for (const bundle of input.resourceBundles ?? []) {
    const name = basename(bundle);
    await cp(bundle, join(input.outputAppPath, name), { recursive: true });
    filesWritten.push(name);
  }

  for (const resource of input.resources ?? []) {
    const name = basename(resource);
    await copyFile(resource, join(input.outputAppPath, name));
    filesWritten.push(name);
  }

  if (input.privacyManifestPath) {
    await copyFile(input.privacyManifestPath, join(input.outputAppPath, "PrivacyInfo.xcprivacy"));
    filesWritten.push("PrivacyInfo.xcprivacy");
  }

  if ((input.embeddedFrameworks ?? []).length > 0) {
    const frameworksDir = join(input.outputAppPath, "Frameworks");
    await mkdir(frameworksDir, { recursive: true });
    for (const framework of input.embeddedFrameworks ?? []) {
      const name = basename(framework);
      await cp(framework, join(frameworksDir, name), { recursive: true });
      filesWritten.push(`Frameworks/${name}`);
    }
  }

  return { ok: true, appPath: input.outputAppPath, filesWritten };
}

function scalar(v: SettingValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(" ") : v;
}
