import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectTsFiles, isBareConsoleLine, scanContent, scanPlugins } from "../check-no-console";
import { runCli } from "./cli";

describe("isBareConsoleLine", () => {
  test("matches the deny list with optional space before the paren", () => {
    for (const fn of ["log", "debug", "info", "warn", "error"]) {
      expect(isBareConsoleLine(`console.${fn}("x")`)).toBe(true);
      expect(isBareConsoleLine(`console.${fn} ("x")`)).toBe(true);
      expect(isBareConsoleLine(`console.${fn}()`)).toBe(true);
    }
  });

  test("does not match other console members or lookalikes", () => {
    expect(isBareConsoleLine("console.table(t)")).toBe(false);
    expect(isBareConsoleLine("Console.log(t)")).toBe(false);
    expect(isBareConsoleLine("logger.info(t)")).toBe(false);
    expect(isBareConsoleLine("console.info;")).toBe(false); // no call paren
  });

  test("stays substring-greedy like grep -E (unanchored)", () => {
    expect(isBareConsoleLine("myconsole.log(t)")).toBe(true);
  });
});

describe("scanContent", () => {
  test("reports 1-based line numbers and the raw line text", () => {
    const content = "const a = 1;\nconsole.log(a);\nconst c = 3;\n";
    expect(scanContent("f.ts", content)).toEqual([
      { path: "f.ts", line: 2, text: "console.log(a);" },
    ]);
  });

  test("returns every matching line in order", () => {
    const content = "console.warn(1);\nexport {};\nconsole.error(2);\n";
    const matches = scanContent("f.ts", content);
    expect(matches.map((m) => m.line)).toEqual([1, 3]);
  });
});

describe("collectTsFiles", () => {
  test("walks .ts files, skips __tests__ trees and symlinked dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "console-scan-test-"));
    const external = mkdtempSync(join(tmpdir(), "console-scan-ext-"));
    try {
      const pkg = join(root, "pkg");
      mkdirSync(join(pkg, "__tests__"), { recursive: true });
      mkdirSync(join(pkg, "nested"), { recursive: true });
      writeFileSync(join(pkg, "a.ts"), "");
      writeFileSync(join(pkg, "b.md"), "");
      writeFileSync(join(pkg, "__tests__", "skip.ts"), "");
      writeFileSync(join(pkg, "nested", "c.ts"), "");
      writeFileSync(join(external, "linked.ts"), "");
      symlinkSync(external, join(pkg, "linked"));
      expect(
        collectTsFiles(root)
          .map((f) => f.slice(root.length + 1))
          .sort(),
      ).toEqual([join("pkg", "a.ts"), join("pkg", "nested", "c.ts")]);
    } finally {
      rmSync(external, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("scanPlugins", () => {
  test("finds offending lines across the tree", () => {
    const root = mkdtempSync(join(tmpdir(), "console-scan-test-"));
    try {
      const pkg = join(root, "plugins", "demo");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "bad.ts"), 'export const f = () => {\n  console.debug("hi");\n};\n');
      const matches = scanPlugins(join(root, "plugins"));
      expect(matches).toHaveLength(1);
      expect(matches[0]?.line).toBe(2);
      expect(matches[0]?.path.endsWith(join("plugins", "demo", "bad.ts"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-no-console CLI", () => {
  test("passes on the real repo", async () => {
    const r = await runCli("check-no-console.ts");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "==> no bare console.* in plugins (use-configured-loggers enforced)",
    );
    expect(r.stderr).toBe("");
  });

  test("exits 1 with grep-shaped path:line:content output on a fixture repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "console-cli-test-"));
    try {
      const pkg = join(root, "plugins", "demo");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "bad.ts"), 'export const f = () => {\n  console.debug("hi");\n};\n');
      const r = await runCli("check-no-console.ts", [], { root });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(
        "ERROR: bare console.* found — use the application's configured logger (rule use-configured-loggers):",
      );
      expect(r.stderr).toContain(`console.debug("hi");`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("output is deterministic across runs on the real repo", async () => {
    const first = await runCli("check-no-console.ts");
    const second = await runCli("check-no-console.ts");
    expect(first.code).toBe(second.code);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stderr).toBe(second.stderr);
    // On the clean repo both runs must be byte-for-byte identical on all streams.
    expect(first.code).toBe(0);
  });
});
