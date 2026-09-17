import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countDirsNamed,
  countLeftoverFiles,
  listTopLevelTs,
  topLevelTsError,
  unresolvedImports,
} from "../check-shipment";
import { runCli } from "./cli";

const installerLanded = existsSync(join(import.meta.dir, "..", "..", "scripts", "install.ts"));

describe("countDirsNamed", () => {
  test("counts matching dirs recursively and tolerates a missing root", () => {
    const root = mkdtempSync(join(tmpdir(), "shipment-test-"));
    try {
      mkdirSync(join(root, "a", "__tests__"), { recursive: true });
      mkdirSync(join(root, "__tests__", "deeper"), { recursive: true });
      mkdirSync(join(root, "plain"), { recursive: true });
      expect(countDirsNamed(root, "__tests__")).toBe(2);
      expect(countDirsNamed(join(root, "missing"), "__tests__")).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("countLeftoverFiles", () => {
  test("counts *.bak and *.original files only", () => {
    const root = mkdtempSync(join(tmpdir(), "shipment-test-"));
    try {
      mkdirSync(join(root, "sub"), { recursive: true });
      writeFileSync(join(root, "x.bak"), "");
      writeFileSync(join(root, "sub", "y.original"), "");
      writeFileSync(join(root, "keep.ts"), "");
      writeFileSync(join(root, "notes.backup"), "");
      expect(countLeftoverFiles(root)).toBe(2);
      expect(countLeftoverFiles(join(root, "missing"))).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listTopLevelTs", () => {
  test("lists only top-level .ts files, sorted; empty for a missing dir", () => {
    const root = mkdtempSync(join(tmpdir(), "shipment-test-"));
    try {
      mkdirSync(join(root, "sub"), { recursive: true });
      writeFileSync(join(root, "b.ts"), "");
      writeFileSync(join(root, "a.ts"), "");
      writeFileSync(join(root, "sub", "c.ts"), "");
      writeFileSync(join(root, "d.md"), "");
      expect(listTopLevelTs(root)).toBe("a.ts\nb.ts");
      expect(listTopLevelTs(join(root, "missing"))).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("topLevelTsError", () => {
  test("accepts only the index.ts factory listing", () => {
    expect(topLevelTsError("index.ts")).toBeUndefined();
    expect(topLevelTsError("")).toContain("non-factory .ts at top of agent/extensions");
    expect(topLevelTsError("helper.ts\nindex.ts")).toContain("helper.ts");
  });
});

describe("unresolvedImports", () => {
  // Resource contract: each test owns a unique mkdtempSync dir, removed in
  // finally — parallel-safe, no shared state, no ordering dependence.
  test("resolves extensionless, .ts, and index targets; ignores bare and node: specifiers", () => {
    const root = mkdtempSync(join(tmpdir(), "ship-closure-ok-"));
    try {
      mkdirSync(join(root, "sub"), { recursive: true });
      writeFileSync(
        join(root, "a.ts"),
        'import { b } from "./b";\nimport "./c";\nimport { d } from "./d.ts";\nimport x from "bare-pkg";\nimport fs from "node:fs";\n',
      );
      writeFileSync(join(root, "b.ts"), "");
      mkdirSync(join(root, "c"), { recursive: true });
      writeFileSync(join(root, "c", "index.ts"), "");
      writeFileSync(join(root, "d.ts"), "");
      expect(unresolvedImports(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("lists dangling static and dynamic relative imports, mtime suffix stripped", () => {
    const root = mkdtempSync(join(tmpdir(), "ship-closure-bad-"));
    try {
      writeFileSync(
        join(root, "a.ts"),
        'import { g } from "./gone";\nconst m = await import("./alsogone?mtime=1");\n',
      );
      writeFileSync(join(root, "deep.ts"), 'import "../missing";\n');
      expect(unresolvedImports(root)).toEqual([
        "a.ts -> ./alsogone",
        "a.ts -> ./gone",
        "deep.ts -> ../missing",
      ]);
      expect(unresolvedImports(join(root, "missing-dir"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-shipment CLI", () => {
  test("errors clearly when the installer is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "shipment-cli-test-"));
    try {
      const r = await runCli("check-shipment.ts", [], { root });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("ERROR: scripts/install.ts not found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.skipIf(!installerLanded)(
    "installs into a temp target from the real repo and ships a clean profile",
    async () => {
      const r = await runCli("check-shipment.ts");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("    __tests__ dirs shipped: 0");
      expect(r.stdout).toContain("    .bak/.original shipped: 0");
      expect(r.stdout).toContain("    top-level agent/extensions .ts: index.ts");
      expect(r.stdout).toContain("==> shipment check OK");
    },
    180_000,
  );
});
