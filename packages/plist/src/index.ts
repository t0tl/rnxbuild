import plistLib from "plist";
import bplistCreator from "bplist-creator";
import bplistParser from "bplist-parser";

export type PlistPrimitive = string | number | boolean | Date | Buffer;
export type PlistValue =
  | PlistPrimitive
  | PlistValue[]
  | { [key: string]: PlistValue };

export interface BuildOptions {
  format: "xml" | "binary";
}

export function buildPlist(
  value: PlistValue,
  opts: BuildOptions,
): Promise<Buffer | string> {
  if (opts.format === "xml") {
    return Promise.resolve(plistLib.build(value as plistLib.PlistValue));
  }
  return Promise.resolve(bplistCreator(value as Record<string, unknown>));
}

export function parsePlist(input: Buffer): Promise<PlistValue> {
  const isBinary = input.subarray(0, 6).toString() === "bplist";
  if (isBinary) {
    const parsed: unknown = bplistParser.parseBuffer(input)[0];
    return Promise.resolve(parsed as PlistValue);
  }
  return Promise.resolve(plistLib.parse(input.toString("utf8")) as PlistValue);
}
