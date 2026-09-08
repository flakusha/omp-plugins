import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRegexSafetyEntries,
  classifyCondition,
  regexSafetySummary,
} from "../check-regex-safety";
import { runCli } from "./cli";

// Rule files store the condition as a JSON literal (backslashes doubled in the
// file). Build fixtures via JSON.stringify so the stored form matches, while
// assertions target the parsed single-backslash regex form — as the .sh does.
const ruleWithCondition = (parsedCondition: string): string =>
  `---\nname: r\ncondition: ${JSON.stringify(parsedCondition)}\ndescription: d\nscope: [text]\n---\nbody\n`;

describe("classifyCondition", () => {
  test("flags a bare unbounded dot-star", () => {
    expect(classifyCondition("a.*b").dotStar).toBe(true);
    expect(classifyCondition(String.raw`[\s\S]{0,40}?x`).dotStar).toBe(false);
  });

  test("flags an unanchored lookahead chain but not an anchored one", () => {
    const unanchored = classifyCondition(String.raw`(?=[\s\S]*alpha)(?=[\s\S]*beta)`);
    expect(unanchored.unanchored).toBe(true);
    expect(classifyCondition(String.raw`^(?=[\s\S]*alpha)`).unanchored).toBe(false);
  });

  test("flags the greedy [\\s\\S]* lead (warning hazard)", () => {
    expect(classifyCondition(String.raw`(?=[\s\S]*alpha)`).greedyLead).toBe(true);
    expect(classifyCondition(String.raw`^(?=documentation)`).greedyLead).toBe(false);
  });

  test("a plain pattern raises no hazard", () => {
    expect(classifyCondition("documentation")).toEqual({
      dotStar: false,
      unanchored: false,
      greedyLead: false,
    });
  });
});

describe("checkRegexSafetyEntries", () => {
  test("emits dot-star before unanchored-chain errors, in .sh order", () => {
    const result = checkRegexSafetyEntries([
      { name: "clean.md", text: ruleWithCondition(String.raw`^(?=[\s\S]*alpha)(?=[\s\S]*beta)`) },
      { name: "dirty.md", text: ruleWithCondition(String.raw`(?=[\s\S]*a.*b)`) },
    ]);
    expect(result.errors).toEqual([
      expect.stringContaining("ERROR dirty.md: unbounded .* (quadratic backtracking):"),
      expect.stringContaining("ERROR dirty.md: unanchored lookahead chain (O(n^2) ReDoS):"),
    ]);
    expect(result.errors[0]).toContain(String.raw`(?=[\s\S]*a.*b)`); // parsed single-backslash form
    expect(result.warnings).toBe(2);
    expect(result.checked).toBe(2);
    expect(regexSafetySummary(result)).toBe(
      "checked 2 rule files: 2 regex-safety errors, 2 greedy-lead warnings",
    );
  });

  test("truncates the echoed condition at 80 chars", () => {
    // anchored chain -> exactly the dot-star error fires
    const long = String.raw`^(?=[\s\S]*a.*` + "y".repeat(200) + String.raw`)`;
    const result = checkRegexSafetyEntries([{ name: "r.md", text: ruleWithCondition(long) }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.endsWith("...")).toBe(true);
    expect(result.errors[0]).not.toContain("y".repeat(120));
  });

  test("fails loud on an unparseable JSON condition", () => {
    // raw (non-JSON) condition value — exactly what json.loads / JSON.parse reject
    const text = `---\nname: broken\ncondition: not-json\ndescription: d\nscope: [text]\n---\n`;
    const result = checkRegexSafetyEntries([{ name: "broken.md", text }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("ERROR broken.md: cannot parse condition as JSON:");
    expect(result.errors[0]).toContain("Unexpected identifier");
  });

  test("checks every condition of a JSON array condition", () => {
    const json = JSON.stringify([String.raw`.*a`, String.raw`^(?=ok)`]);
    const result = checkRegexSafetyEntries([
      {
        name: "multi.md",
        text: `---\nname: r\ncondition: ${json}\ndescription: d\nscope: [text]\n---\n`,
      },
    ]);
    expect(result.errors).toEqual([
      "ERROR multi.md: unbounded .* (quadratic backtracking): .*a...",
    ]);
    expect(result.warnings).toBe(0);
  });

  test("skips files without frontmatter or condition, but counts them as checked", () => {
    const result = checkRegexSafetyEntries([
      { name: "a.md", text: "plain file" },
      { name: "b.md", text: "---\nname: b\ndescription: d\nscope: [text]\n---\n" },
      { name: "notes.txt", text: ruleWithCondition(String.raw`^(?=fine)`) },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.checked).toBe(3);
    expect(regexSafetySummary(result)).toBe(
      "checked 3 rule files: 0 regex-safety errors, 0 greedy-lead warnings",
    );
  });
});

describe("check-regex-safety CLI", () => {
  test("passes on the real repo with a per-file summary line", async () => {
    const r = await runCli("check-regex-safety.ts");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /checked \d+ rule files: 0 regex-safety errors, \d+ greedy-lead warnings/,
    );
    expect(r.stderr).toBe("");
  });

  test("exits 1 listing ERROR lines on a dirty fixture repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "regex-safety-test-"));
    try {
      const rules = join(root, "plugins", "oh-my-pi-integration", "rules");
      mkdirSync(rules, { recursive: true });
      writeFileSync(join(rules, "dirty.md"), ruleWithCondition(String.raw`(?=[\s\S]*alpha.*beta)`));
      const r = await runCli("check-regex-safety.ts", [], { root });
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("ERROR dirty.md: unanchored lookahead chain (O(n^2) ReDoS)");
      expect(r.stdout).toContain("ERROR dirty.md: unbounded .* (quadratic backtracking)");
      expect(r.stdout).toContain("2 regex-safety errors, 1 greedy-lead warnings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
