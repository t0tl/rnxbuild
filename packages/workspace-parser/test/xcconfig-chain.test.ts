import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadXcconfigChain } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("loadXcconfigChain", () => {
  it("returns a single entry for an xcconfig with no includes", async () => {
    const chain = await loadXcconfigChain(resolve(here, "fixtures/Base.xcconfig"));
    expect(chain).toHaveLength(1);
    expect(chain[0]!.path).toContain("Base.xcconfig");
  });

  it("returns includes in dependency order (deepest first)", async () => {
    const chain = await loadXcconfigChain(resolve(here, "fixtures/Chained.xcconfig"));
    // Order: Base → ChainedMid → Chained (most-base first, so the cascade applies in that order)
    expect(chain.map((c) => c.path.split("/").pop())).toEqual([
      "Base.xcconfig",
      "ChainedMid.xcconfig",
      "Chained.xcconfig",
    ]);
  });

  it("does not duplicate an xcconfig included via multiple paths", async () => {
    // (Base is included only once via ChainedMid; loading Chained should give it once)
    const chain = await loadXcconfigChain(resolve(here, "fixtures/Chained.xcconfig"));
    const names = chain.map((c) => c.path.split("/").pop());
    expect(names.filter((n) => n === "Base.xcconfig")).toHaveLength(1);
  });

  it("detects and throws on include cycles", async () => {
    await expect(
      loadXcconfigChain(resolve(here, "fixtures/Cycle.xcconfig")),
    ).rejects.toThrow(/cycle/i);
  });
});
