const INHERITED = "$(inherited)";

/**
 * Single-pass variable substitution. Replaces $(VAR) and ${VAR} with their values
 * from `vars`. Does NOT recurse into the substituted values (Task 10 adds recursion).
 * Preserves `$(inherited)` verbatim — the cascade resolves it.
 */
export function substituteVariables(input: string, vars: Record<string, string>): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    if (input.startsWith(INHERITED, i)) {
      out += INHERITED;
      i += INHERITED.length;
      continue;
    }

    const open = matchOpen(input, i);
    if (!open) {
      out += input[i];
      i++;
      continue;
    }
    const close = input.indexOf(open.closeChar, i + 2);
    if (close < 0) {
      out += input[i];
      i++;
      continue;
    }
    const key = input.slice(i + 2, close);
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      out += vars[key] ?? "";
    } else {
      out += "";
    }
    i = close + 1;
  }
  return out;
}

function matchOpen(input: string, i: number): { closeChar: string } | null {
  if (input[i] === "$" && input[i + 1] === "(") return { closeChar: ")" };
  if (input[i] === "$" && input[i + 1] === "{") return { closeChar: "}" };
  return null;
}
