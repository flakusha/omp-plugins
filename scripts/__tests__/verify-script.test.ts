import { describe, expect, test } from "bun:test";

interface PackageJson {
  scripts: Record<string, string>;
}

const pkg: PackageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json();

const scripts = pkg.scripts;
// Shell `&&` is the step separator, so steps are asserted individually — a
// substring match over the whole chain would only test the prose around them.
const verifySteps = (scripts.verify ?? "").split("&&").map((step) => step.trim());

// Suite execution is either a direct `bun test` step or the coverage gate,
// whose check-coverage.ts spawns `bun test --coverage` over the whole repo.
// A verify that contains both runs every test twice — that is the regression.
const runsSuite = (step: string): boolean =>
  /\bbun (run )?test\b/.test(step) || step === "bun run check:coverage";

describe("verify script", () => {
  test("executes the test suite exactly once, through the coverage gate", () => {
    expect(verifySteps.filter(runsSuite)).toEqual(["bun run check:coverage"]);
  });

  test("runs the coverage gate that fails on a non-zero suite exit", () => {
    expect(verifySteps).toContain("bun run check:coverage");
    expect(scripts["check:coverage"]).toBe("bun scripts/check-coverage.ts");
  });

  test("keeps the remaining gates in order", () => {
    expect(verifySteps).toEqual([
      "bun run lint",
      "bun run typecheck",
      "bun run check:coverage",
      "bun run check:knip",
      "bun run check:cpd",
      "bun run check:size",
      "bun run check:rules",
      "bun run check:regex",
      "bun run check:ship",
    ]);
  });
});

describe("test script", () => {
  test("remains the standalone fast inner loop", () => {
    expect(scripts.test).toBe("bun test");
  });
});
