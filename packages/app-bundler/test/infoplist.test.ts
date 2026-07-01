import { describe, expect, it } from "vitest";
import { synthesizeInfoPlist } from "../src/infoplist.js";
import type { BuildContext } from "@rnxbuild/build-settings";

const CTX: BuildContext = { sdk: "iphoneos17.0", arch: "arm64", config: "Debug" };

describe("synthesizeInfoPlist - Xcode-default keys", () => {
  it("populates CFBundleExecutable from EXECUTABLE_NAME", () => {
    expect(synthesizeInfoPlist(baseInput({ settings: { EXECUTABLE_NAME: "MyApp" } })).CFBundleExecutable).toBe(
      "MyApp",
    );
  });

  it("falls back to productModuleName when EXECUTABLE_NAME is unset", () => {
    expect(synthesizeInfoPlist(baseInput({ productModuleName: "FallbackApp" })).CFBundleExecutable).toBe(
      "FallbackApp",
    );
  });

  it("populates CFBundleIdentifier from PRODUCT_BUNDLE_IDENTIFIER", () => {
    expect(
      synthesizeInfoPlist(baseInput({ settings: { PRODUCT_BUNDLE_IDENTIFIER: "com.example.app" } }))
        .CFBundleIdentifier,
    ).toBe("com.example.app");
  });

  it("populates CFBundleName from PRODUCT_NAME", () => {
    expect(synthesizeInfoPlist(baseInput({ settings: { PRODUCT_NAME: "MyName" } })).CFBundleName).toBe(
      "MyName",
    );
  });

  it("always emits CFBundlePackageType=APPL", () => {
    expect(synthesizeInfoPlist(baseInput()).CFBundlePackageType).toBe("APPL");
  });

  it("populates CFBundleShortVersionString from MARKETING_VERSION with fallback", () => {
    expect(
      synthesizeInfoPlist(baseInput({ settings: { MARKETING_VERSION: "2.1" } })).CFBundleShortVersionString,
    ).toBe("2.1");
    expect(synthesizeInfoPlist(baseInput()).CFBundleShortVersionString).toBe("1.0");
  });

  it("populates CFBundleVersion from CURRENT_PROJECT_VERSION with fallback", () => {
    expect(
      synthesizeInfoPlist(baseInput({ settings: { CURRENT_PROJECT_VERSION: "42" } })).CFBundleVersion,
    ).toBe("42");
    expect(synthesizeInfoPlist(baseInput()).CFBundleVersion).toBe("1");
  });

  it("populates MinimumOSVersion from IPHONEOS_DEPLOYMENT_TARGET", () => {
    expect(
      synthesizeInfoPlist(baseInput({ settings: { IPHONEOS_DEPLOYMENT_TARGET: "16.4" } })).MinimumOSVersion,
    ).toBe("16.4");
  });

  it("populates DTPlatformName from context.sdk's platform prefix", () => {
    expect(synthesizeInfoPlist(baseInput()).DTPlatformName).toBe("iphoneos");
  });

  it("populates CFBundleSupportedPlatforms for iphoneos", () => {
    expect(synthesizeInfoPlist(baseInput()).CFBundleSupportedPlatforms).toEqual(["iPhoneOS"]);
  });

  it("always emits LSRequiresIPhoneOS=true", () => {
    expect(synthesizeInfoPlist(baseInput()).LSRequiresIPhoneOS).toBe(true);
  });

  it("emits CFBundleInfoDictionaryVersion and CFBundleDevelopmentRegion", () => {
    const p = synthesizeInfoPlist(baseInput());
    expect(p.CFBundleInfoDictionaryVersion).toBe("6.0");
    expect(p.CFBundleDevelopmentRegion).toBe("en");
  });

  it("parses TARGETED_DEVICE_FAMILY into UIDeviceFamily", () => {
    expect(
      synthesizeInfoPlist(baseInput({ settings: { TARGETED_DEVICE_FAMILY: "1,2" } })).UIDeviceFamily,
    ).toEqual([1, 2]);
  });
});

describe("synthesizeInfoPlist - INFOPLIST_KEY_* convention", () => {
  it("converts INFOPLIST_KEY_<suffix> settings into plist keys", () => {
    const p = synthesizeInfoPlist(
      baseInput({
        settings: {
          INFOPLIST_KEY_CFBundleDisplayName: "My App",
          INFOPLIST_KEY_UIApplicationSceneManifest_Generation: "YES",
        },
      }),
    );
    expect(p.CFBundleDisplayName).toBe("My App");
    expect(p.UIApplicationSceneManifest_Generation).toBe("YES");
  });

  it("keeps INFOPLIST_KEY_ array values as plist arrays", () => {
    const p = synthesizeInfoPlist(
      baseInput({
        settings: {
          INFOPLIST_KEY_UISupportedInterfaceOrientations: [
            "UIInterfaceOrientationPortrait",
            "UIInterfaceOrientationLandscapeLeft",
          ],
        },
      }),
    );
    expect(p.UISupportedInterfaceOrientations).toEqual([
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationLandscapeLeft",
    ]);
  });
});

describe("synthesizeInfoPlist - user Info.plist merge", () => {
  it("user-supplied plist keys override synthesized defaults", () => {
    const p = synthesizeInfoPlist(
      baseInput({
        settings: { PRODUCT_NAME: "FromSettings" },
        userInfoPlist: { CFBundleName: "FromUserPlist", CustomKey: "hello" },
      }),
    );
    expect(p.CFBundleName).toBe("FromUserPlist");
    expect(p.CustomKey).toBe("hello");
  });

  it("synthesized keys are kept when not overridden", () => {
    const p = synthesizeInfoPlist(baseInput({ userInfoPlist: { CustomKey: "hello" } }));
    expect(p.CFBundleExecutable).toBe("App");
    expect(p.CustomKey).toBe("hello");
  });
});

function baseInput(
  overrides: Partial<Parameters<typeof synthesizeInfoPlist>[0]> = {},
): Parameters<typeof synthesizeInfoPlist>[0] {
  return {
    settings: {},
    context: CTX,
    productModuleName: "App",
    sdkPath: "/abs/iPhoneOS.sdk",
    ...overrides,
  };
}
