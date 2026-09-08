import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSchemaEntries,
  extractFrontmatter,
  parseFrontmatterFields,
  schemaSummary,
  scopeItemsOf,
  validateRule,
} from "../check-rules-sync";
import { runCli } from "./cli";

const VALID_RULE = `---
name: sample-rule
description: Keeps sample rules deterministic
condition: "some condition text"
scope: [text, "thinking", tool:git(status)]
---
body text
`;

/** Rule text whose `name:` field defaults to the filename stem, per the contract. */
const ruleText = (stem: string, overrides: Record<string, string> = {}): string => {
  const fields = {
    name: stem,
    description: "Keeps sample rules deterministic",
    condition: "some condition",
    scope: "[text]",
    ...overrides,
  };
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${body}\n---\nbody text\n`;
};

describe("extractFrontmatter", () => {
  test("returns the body between the fences", () => {
    expect(extractFrontmatter(VALID_RULE)).toBe(
      `name: sample-rule\ndescription: Keeps sample rules deterministic\ncondition: "some condition text"\nscope: [text, "thinking", tool:git(status)]`,
    );
  });

  test("returns undefined when the file does not start with a frontmatter block", () => {
    expect(extractFrontmatter("no fences here\n")).toBeUndefined();
    expect(extractFrontmatter(`---\n---\n`)).toBeUndefined(); // no body line between fences
    expect(extractFrontmatter(`\n---\nx: 1\n---\n`)).toBeUndefined(); // must start at offset 0
  });
});

describe("parseFrontmatterFields", () => {
  test("first occurrence wins and values are trimmed and unquoted", () => {
    expect(parseFrontmatterFields(`name: a\nname: b\ndescription: "quoted"`)).toEqual({
      name: "a",
      description: "quoted",
    });
  });

  test("skips lines without a colon", () => {
    expect(parseFrontmatterFields("just text\nname: a")).toEqual({ name: "a" });
  });
});

describe("scopeItemsOf", () => {
  test("parses bare, quoted and bracketed lists", () => {
    expect(scopeItemsOf(`[text, "thinking"]`)).toEqual(["text", "thinking"]);
    expect(scopeItemsOf(`text, thinking`)).toEqual(["text", "thinking"]);
    expect(scopeItemsOf(`[[text]]`)).toEqual(["text"]);
  });

  test("drops empty entries but keeps quote-only entries (python strip parity)", () => {
    expect(scopeItemsOf(`[text,,thinking]`)).toEqual(["text", "thinking"]);
    expect(scopeItemsOf(`[""]`)).toEqual([""]);
  });
});

describe("validateRule", () => {
  test("accepts a fully-formed rule", () => {
    expect(validateRule("sample-rule.md", VALID_RULE)).toEqual([]);
  });

  test("flags missing frontmatter", () => {
    expect(validateRule("sample-rule.md", "no fences here\n")).toEqual([
      "FAIL sample-rule.md: missing frontmatter",
    ]);
  });

  test("flags a name that differs from the filename stem", () => {
    expect(validateRule("sample-rule.md", ruleText("sample-rule", { name: "other" }))).toEqual([
      "FAIL sample-rule.md: frontmatter name 'other' != filename stem 'sample-rule'",
    ]);
  });

  test("renders an absent name python-style as None", () => {
    const text = `---\ndescription: d\ncondition: c\nscope: [text]\n---\n`;
    expect(validateRule("sample-rule.md", text)).toEqual([
      "FAIL sample-rule.md: frontmatter name None != filename stem 'sample-rule'",
    ]);
  });

  test("flags missing description, condition and scope", () => {
    expect(validateRule("s.md", ruleText("s", { description: "" }))).toEqual([
      "FAIL s.md: missing description",
    ]);
    expect(validateRule("s.md", ruleText("s", { condition: "" }))).toEqual([
      "FAIL s.md: missing condition",
    ]);
    expect(validateRule("s.md", ruleText("s", { scope: "[]" }))).toEqual([
      "FAIL s.md: missing/empty scope",
    ]);
  });

  test("accepts tool scopes with optional patterns and rejects the rest", () => {
    expect(validateRule("s.md", ruleText("s", { scope: "[tool:bash, tool:git(rm -rf)]" }))).toEqual(
      [],
    );
    expect(validateRule("s.md", ruleText("s", { scope: "[audio]" }))).toEqual([
      "FAIL s.md: invalid scope entry 'audio'",
    ]);
    expect(validateRule("s.md", ruleText("s", { scope: "[tool:Bash]" }))).toEqual([
      "FAIL s.md: invalid scope entry 'tool:Bash'",
    ]);
    expect(validateRule("s.md", ruleText("s", { scope: "[tool:1bash]" }))).toEqual([
      "FAIL s.md: invalid scope entry 'tool:1bash'",
    ]);
    expect(validateRule("s.md", ruleText("s", { scope: "[tool:bash(o]" }))).toEqual([
      "FAIL s.md: invalid scope entry 'tool:bash(o'",
    ]);
  });

  test("emits failures in the .sh check order", () => {
    const text = `---\nname: other\nscope: []\n---\n`;
    expect(validateRule("x.md", text)).toEqual([
      "FAIL x.md: frontmatter name 'other' != filename stem 'x'",
      "FAIL x.md: missing description",
      "FAIL x.md: missing condition",
      "FAIL x.md: missing/empty scope",
    ]);
  });
});

describe("checkSchemaEntries / schemaSummary", () => {
  test("counts every .md, skips other files, reports failures", () => {
    const result = checkSchemaEntries([
      { name: "sample-rule.md", text: VALID_RULE },
      { name: "README.txt", text: "garbage" },
      { name: "b.md", text: "no frontmatter" },
    ]);
    expect(result.checked).toBe(2);
    expect(result.failures).toEqual(["FAIL b.md: missing frontmatter"]);
    expect(schemaSummary(result)).toBe("checked 2 rules, 1 failures");
  });
});

describe("check-rules-sync CLI", () => {
  test("schema-only passes on the real repo", async () => {
    const r = await runCli("check-rules-sync.ts", ["--schema-only"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/checked \d+ rules, 0 failures/);
    expect(r.stdout).toContain("==> rules schema check (");
    expect(r.stdout).toContain("==> rules bundle OK");
    expect(r.stderr).toBe("");
  });

  test("reports schema failures and exits 1 on a fixture repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "rules-sync-test-"));
    try {
      const rules = join(root, "plugins", "oh-my-pi-integration", "rules");
      mkdirSync(rules, { recursive: true });
      writeFileSync(join(rules, "good.md"), ruleText("good"));
      writeFileSync(join(rules, "bad.md"), ruleText("bad", { name: "mismatch" }));
      const r = await runCli("check-rules-sync.ts", ["--schema-only"], { root });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("ERROR: rules schema broken");
      expect(r.stdout).toContain("FAIL bad.md: frontmatter name 'mismatch' != filename stem 'bad'");
      expect(r.stdout).toContain("checked 2 rules, 1 failures");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips the laydown half with an explicit SKIP line when install.ts is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "rules-sync-test-"));
    try {
      const rules = join(root, "plugins", "oh-my-pi-integration", "rules");
      mkdirSync(rules, { recursive: true });
      writeFileSync(join(rules, "good.md"), ruleText("good"));
      const r = await runCli("check-rules-sync.ts", [], { root });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("==> rules laydown sync (installer dry-run)");
      expect(r.stdout).toContain("SKIP: scripts/install.ts not present");
      expect(r.stdout).toContain("==> rules bundle OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.skipIf(!existsSync(join(import.meta.dir, "..", "..", "scripts", "install.ts")))(
    "laydown half matches shipped count x2 on the real repo",
    async () => {
      const r = await runCli("check-rules-sync.ts");
      expect(r.code).toBe(0);
      const m = /shipped: (\d+) {3}laid: (\d+) \(expected: (\d+)\)/.exec(r.stdout);
      const [, shipped, laid, expected] = m!;
      expect(Number(laid)).toBe(Number(expected));
      expect(Number(expected)).toBe(Number(shipped) * 2);
    },
    120_000,
  );
});
