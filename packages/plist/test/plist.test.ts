import { describe, expect, it } from "vitest";
import { parsePlist, buildPlist, type PlistValue } from "../src/index.js";

describe("parsePlist / buildPlist", () => {
  const sample: PlistValue = {
    CFBundleIdentifier: "com.example.test",
    CFBundleVersion: "1",
    UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait"],
    NestedDict: { foo: 42, bar: true },
  };

  it("XML round-trip preserves shape", async () => {
    const xml = await buildPlist(sample, { format: "xml" });
    expect(typeof xml).toBe("string");
    expect(xml as string).toMatch(/^<\?xml/);
    expect(xml as string).toContain("com.example.test");
    const parsed = await parsePlist(Buffer.from(xml as string));
    expect(parsed).toEqual(sample);
  });

  it("binary round-trip preserves shape", async () => {
    const bin = await buildPlist(sample, { format: "binary" });
    expect(Buffer.isBuffer(bin)).toBe(true);
    expect((bin as Buffer).subarray(0, 6).toString()).toBe("bplist");
    const parsed = await parsePlist(bin as Buffer);
    expect(parsed).toEqual(sample);
  });

  it("parsePlist auto-detects format (XML)", async () => {
    const xml = await buildPlist(sample, { format: "xml" });
    const parsed = await parsePlist(Buffer.from(xml as string));
    expect(parsed).toEqual(sample);
  });

  it("parsePlist auto-detects format (binary)", async () => {
    const bin = await buildPlist(sample, { format: "binary" });
    const parsed = await parsePlist(bin as Buffer);
    expect(parsed).toEqual(sample);
  });

  it("buildPlist with binary format starts with bplist00 magic", async () => {
    const bin = await buildPlist({ a: 1 }, { format: "binary" });
    expect((bin as Buffer).subarray(0, 8).toString()).toBe("bplist00");
  });
});
