import { describe, expect, test } from "bun:test";
import { formatLintNote, lintablePath } from "../util/lint-feedback";

describe("lintablePath", () => {
  test("accepts repo TS files", () => {
    expect(lintablePath("src/x.ts")).toBe(true);
    expect(lintablePath("/abs/path/component.tsx")).toBe(true);
  });

  test("rejects non-TS and dependencies", () => {
    expect(lintablePath("src/x.js")).toBe(false);
    expect(lintablePath("src/x.md")).toBe(false);
    expect(lintablePath("node_modules/foo/index.ts")).toBe(false);
    expect(lintablePath("")).toBe(false);
  });
});

describe("formatLintNote", () => {
  const diag =
    "/repo/src/x.ts:12:5 lint/style/noExplicitAny \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n" +
    "  \u00d7 Unexpected any. Specify a different type.\n" +
    "  > 12 \u2502 const x: any = 1;\n" +
    "\u2502\n";

  test("summarizes biome diagnostics into a bounded note", () => {
    const note = formatLintNote("/repo/src/x.ts", diag);
    expect(note).not.toBeUndefined();
    expect(note).toContain("1 lint issue");
    expect(note).toContain("noExplicitAny");
    expect(note).toContain("12:5");
  });

  test("caps the listed diagnostics", () => {
    const many = Array.from({ length: 9 }, (_, i) => `f.ts:${i}:1 lint/style/noFoo \u2501`).join(
      "\n",
    );
    const note = formatLintNote("f.ts", many);
    expect(note).toContain("9 lint issue");
    expect(note).toContain("…3 more");
  });

  test("returns undefined on clean output", () => {
    expect(formatLintNote("f.ts", "Checked 1 file in 7ms. No fixes applied.")).toBeUndefined();
    expect(formatLintNote("f.ts", "")).toBeUndefined();
  });
});
