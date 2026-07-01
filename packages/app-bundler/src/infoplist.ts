import type { BuildContext, SettingsDict, SettingValue } from "@rnxbuild/build-settings";
import type { PlistValue } from "@rnxbuild/plist";

export interface SynthesizeInfoPlistInput {
  settings: SettingsDict;
  context: BuildContext;
  productModuleName: string;
  sdkPath: string;
  /** Optional parsed user-authored Info.plist. User keys override synthesized defaults. */
  userInfoPlist?: Record<string, PlistValue>;
}

const INFOPLIST_KEY_PREFIX = "INFOPLIST_KEY_";

export function synthesizeInfoPlist(input: SynthesizeInfoPlistInput): Record<string, PlistValue> {
  const s = input.settings;
  const platform = platformName(input.context.sdk);

  const out: Record<string, PlistValue> = {
    BuildMachineOSBuild: "",
    CFBundleDevelopmentRegion: "en",
    CFBundleExecutable: scalar(s.EXECUTABLE_NAME) ?? input.productModuleName,
    CFBundleIdentifier: scalar(s.PRODUCT_BUNDLE_IDENTIFIER) ?? "",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: scalar(s.PRODUCT_NAME) ?? input.productModuleName,
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: scalar(s.MARKETING_VERSION) ?? "1.0",
    CFBundleSupportedPlatforms: [platformToBundlePlatform(platform)],
    CFBundleVersion: scalar(s.CURRENT_PROJECT_VERSION) ?? "1",
    DTCompiler: "com.apple.compilers.llvm.clang.1_0",
    DTPlatformName: platform,
    DTPlatformVersion: sdkVersion(input.context.sdk) ?? sdkVersionFromPath(input.sdkPath) ?? "",
    DTSDKName: scalar(s.SDK_NAME) ?? input.context.sdk,
    DTXcode: "1650",
    DTXcodeBuild: "17F42",
    LSRequiresIPhoneOS: true,
    MinimumOSVersion: scalar(s.IPHONEOS_DEPLOYMENT_TARGET) ?? "17.0",
    UIDeviceFamily: parseDeviceFamily(scalar(s.TARGETED_DEVICE_FAMILY)),
  };

  for (const [key, value] of Object.entries(s)) {
    if (!key.startsWith(INFOPLIST_KEY_PREFIX)) continue;
    out[key.slice(INFOPLIST_KEY_PREFIX.length)] = value;
  }

  return { ...out, ...(input.userInfoPlist ?? {}) };
}

function scalar(v: SettingValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(" ") : v;
}

function platformName(sdk: string): string {
  const match = /^([A-Za-z]+)[0-9.]*$/.exec(sdk);
  return (match?.[1] ?? sdk).toLowerCase();
}

function platformToBundlePlatform(platform: string): string {
  if (platform === "iphoneos") return "iPhoneOS";
  return platform;
}

function sdkVersion(sdk: string): string | undefined {
  return /^[A-Za-z]+([0-9.]+)$/.exec(sdk)?.[1];
}

function sdkVersionFromPath(sdkPath: string): string | undefined {
  return /[A-Za-z]+([0-9.]+)\.sdk$/.exec(sdkPath)?.[1];
}

function parseDeviceFamily(raw: string | undefined): number[] {
  return (raw ?? "1")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n));
}
