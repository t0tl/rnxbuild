export interface BuildContext {
  /** Full sdk name, e.g. "iphoneos17.0" or "iphonesimulator17.0". */
  sdk: string;
  /** Architecture, e.g. "arm64" or "x86_64". */
  arch: string;
  /** Build configuration name, e.g. "Debug" or "Release". */
  config: string;
}

/**
 * Decide whether a conditional setting entry applies to the given build context.
 * The condition string is the inside of the `[...]` brackets, e.g. "sdk=iphoneos*"
 * or "sdk=iphoneos*,arch=arm64". `null` means unconditional (always applies).
 */
export function selectConditional(
  _key: string,
  condition: string | null,
  ctx: BuildContext,
): boolean {
  if (condition === null) return true;
  return condition.split(",").every((part) => matchOne(part.trim(), ctx));
}

function matchOne(selector: string, ctx: BuildContext): boolean {
  const eq = selector.indexOf("=");
  if (eq < 0) return false;
  const key = selector.slice(0, eq).trim();
  const pattern = selector.slice(eq + 1).trim();
  const target = ctxKey(ctx, key);
  if (target === undefined) return false;
  return globMatch(target, pattern);
}

function ctxKey(ctx: BuildContext, key: string): string | undefined {
  if (key === "sdk") return ctx.sdk;
  if (key === "arch") return ctx.arch;
  if (key === "config") return ctx.config;
  return undefined;
}

function globMatch(value: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return regex.test(value);
}
