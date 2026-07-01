import type { SourceLang } from "./types.js";

/**
 * Pure: bucket source files by language based on file extension.
 * Unknown extensions are dropped.
 *
 * Extension mapping (case-insensitive):
 *   .swift           → swift
 *   .m               → objc
 *   .mm              → objcpp
 *   .c               → c
 *   .cpp/.cc/.cxx    → cpp
 */
export function partitionSourcesByLang(sources: string[]): Record<SourceLang, string[]> {
  const out: Record<SourceLang, string[]> = {
    swift: [],
    objc: [],
    objcpp: [],
    c: [],
    cpp: [],
  };
  for (const src of sources) {
    const m = /\.([^./\\]+)$/.exec(src);
    if (!m) continue;
    const ext = m[1]!.toLowerCase();
    switch (ext) {
      case "swift": out.swift.push(src); break;
      case "m":     out.objc.push(src); break;
      case "mm":    out.objcpp.push(src); break;
      case "c":     out.c.push(src); break;
      case "cpp":
      case "cc":
      case "cxx":   out.cpp.push(src); break;
      // anything else is dropped
    }
  }
  return out;
}
