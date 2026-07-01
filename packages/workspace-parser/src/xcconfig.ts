import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface XcconfigSetting {
  key: string;
  /** The `[sdk=...]`/`[arch=...]`/`[config=...]` selector, or null if unconditional. */
  condition: string | null;
  value: string | string[];  // matches @rnxbuild/build-settings's SettingValue shape (kept structural to avoid an import cycle)
}

export interface ParsedXcconfig {
  path: string;
  settings: XcconfigSetting[];
  /** Absolute paths to included xcconfigs, in declaration order. */
  includes: string[];
}

const SETTING_RE = /^([A-Z_][A-Z0-9_]*)(\[([^\]]+)\])?\s*=\s*(.*)$/i;
const INCLUDE_RE = /^#include\s+"([^"]+)"\s*$/;

/**
 * Shell-style tokenization for an xcconfig setting value.
 *
 * Splits on whitespace OUTSIDE quoted segments; strips quotes from segments;
 * concatenates adjacent quoted/unquoted segments within a single token (so
 * `-l"Foo"` → `-lFoo` and `pre"mid"post` → `premidpost`). Returns a bare
 * `string` only when the result is a single token AND the original had no
 * whitespace/quotes (preserves the scalar feel of settings like
 * `PRODUCT_NAME = HelloApp`). Otherwise returns `string[]`.
 */
export function tokenizeXcconfigValue(raw: string): string | string[] {
  if (raw === "") return "";

  // Fast path: no whitespace and no quotes → bare scalar
  if (!/[\s"]/.test(raw)) return raw;

  const tokens: string[] = [];
  let current = ""; // accumulator for the current token
  let inToken = false;
  let inQuotes = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
        // Stay in the same token — don't reset inToken (allows pre"mid"post concat)
      } else {
        current += ch;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      inToken = true; // entering a quoted segment counts as token content
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      // whitespace: token boundary if we have content
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      i++;
      continue;
    }
    // ordinary char
    current += ch;
    inToken = true;
    i++;
  }
  if (inToken) tokens.push(current);

  if (tokens.length === 1) return tokens[0]!;
  return tokens;
}

export async function parseXcconfig(path: string): Promise<ParsedXcconfig> {
  const text = await readFile(path, "utf8");
  const base = dirname(path);

  const settings: XcconfigSetting[] = [];
  const includes: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const stripped = stripComment(rawLine).trim();
    if (!stripped) continue;

    const inc = INCLUDE_RE.exec(stripped);
    if (inc) {
      includes.push(resolve(base, inc[1]!));
      continue;
    }

    const match = SETTING_RE.exec(stripped);
    if (!match) continue;
    const [, key, , condition, valueRaw] = match;
    if (!key) continue;
    settings.push({
      key,
      condition: condition ?? null,
      value: tokenizeXcconfigValue(valueRaw?.trim() ?? ""),
    });
  }

  return { path, settings, includes };
}

/**
 * Recursively load an xcconfig and all its #include'd ancestors. Returns the
 * flat chain in DEPENDENCY ORDER (most-base first) so the build-settings
 * cascade can apply them left-to-right with later entries overriding earlier.
 *
 * Each xcconfig is loaded at most once even if reachable via multiple paths.
 * Throws on include cycles (which Xcode itself also rejects).
 */
export async function loadXcconfigChain(rootPath: string): Promise<ParsedXcconfig[]> {
  const visited = new Set<string>();
  const inProgress = new Set<string>(); // for cycle detection
  const out: ParsedXcconfig[] = [];

  async function visit(path: string): Promise<void> {
    if (inProgress.has(path)) {
      throw new Error(`xcconfig include cycle detected at ${path}`);
    }
    if (visited.has(path)) return;
    inProgress.add(path);
    const parsed = await parseXcconfig(path);
    for (const inc of parsed.includes) await visit(inc);
    inProgress.delete(path);
    visited.add(path);
    out.push(parsed);
  }

  await visit(rootPath);
  return out;
}

function stripComment(line: string): string {
  // Strip everything from "//" onward, but not when it's inside a double-quoted
  // string (xcconfigs use quoted strings for #include paths). Simple state machine.
  let inString = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    else if (!inString && ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}
