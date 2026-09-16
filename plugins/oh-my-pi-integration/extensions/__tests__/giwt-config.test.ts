import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dumpGiwtConfig,
  giwtEnv,
  giwtOnPath,
  resolveGiwtConfig,
  resolvePlanDir,
  resolveReceiptPath,
} from "../util/giwt-config";

const TMP = join(tmpdir(), `giwt-cfg-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });

afterAll(() => {
  try {
    require("node:fs").rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("resolveGiwtConfig", () => {
  test("returns defaults when no giwt.toml or .tmp/giwt present", () => {
    const dir = join(TMP, "no-giwt");
    mkdirSync(dir, { recursive: true });
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.available).toBe(false);
    expect(cfg.repoRoot).toBe(dir);
    expect(cfg.treeDir).toBe(join(dir, "tree"));
    expect(cfg.runlogDir).toBe(join(dir, ".tmp/giwt"));
    expect(cfg.ledgerPath).toBe(join(dir, "tree", ".ledger.jsonl"));
    expect(cfg.planDir).toBe(join(dir, ".plan"));
    expect(cfg.ticketsDir).toBe(join(dir, ".plan/tickets"));
  });

  test("available=true when .tmp/giwt dir exists", () => {
    const dir = join(TMP, "has-tmp");
    mkdirSync(join(dir, ".tmp", "giwt"), { recursive: true });
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.available).toBe(true);
  });

  test("available=true when giwt.toml exists", () => {
    const dir = join(TMP, "has-toml");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "giwt.toml"), '[paths]\ntree = "custom-tree"\n');
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.available).toBe(true);
    expect(cfg.treeDir).toBe(join(dir, "custom-tree"));
  });

  test("parses paths from giwt.toml", () => {
    const dir = join(TMP, "parsed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "giwt.toml"),
      '[paths]\ntree = "wt"\nplan = ".plan"\ntickets = ".plan/tix"\n',
    );
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.treeDir).toBe(join(dir, "wt"));
    expect(cfg.planDir).toBe(join(dir, ".plan"));
    expect(cfg.ticketsDir).toBe(join(dir, ".plan/tix"));
  });

  test("falls back to defaults on malformed giwt.toml", () => {
    const dir = join(TMP, "malformed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "giwt.toml"), "not valid toml {{{");
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.available).toBe(true);
    expect(cfg.treeDir).toBe(join(dir, "tree"));
  });

  test("handles undefined cwd", () => {
    const cfg = resolveGiwtConfig(undefined);
    expect(cfg.repoRoot).toBe(process.cwd());
  });
});

describe("giwtOnPath", () => {
  test("returns false for empty PATH", () => {
    expect(giwtOnPath("")).toBe(false);
  });

  test("returns false when giwt not in dirs", () => {
    const bin = join(TMP, "no-giwt-bin");
    mkdirSync(bin, { recursive: true });
    expect(giwtOnPath(bin)).toBe(false);
  });

  test("returns true when giwt binary exists in a PATH dir", () => {
    const bin = join(TMP, "has-giwt-bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "giwt"), "#!/bin/sh\n");
    expect(giwtOnPath(bin)).toBe(true);
  });
});

describe("giwtEnv", () => {
  test("sets TREE_DIR from OMP_WORKTREE_DIR when set", () => {
    const saved = process.env.OMP_WORKTREE_DIR;
    process.env.OMP_WORKTREE_DIR = "/some/wt-dir";
    try {
      const env = giwtEnv("/repo");
      expect(env.TREE_DIR).toBe("/some/wt-dir");
      expect(env.REPO_ROOT).toBe("/repo");
    } finally {
      if (saved === undefined) delete process.env.OMP_WORKTREE_DIR;
      else process.env.OMP_WORKTREE_DIR = saved;
    }
  });

  test("does not set TREE_DIR when OMP_WORKTREE_DIR unset", () => {
    const saved = process.env.OMP_WORKTREE_DIR;
    delete process.env.OMP_WORKTREE_DIR;
    try {
      const env = giwtEnv("/repo");
      expect(env.TREE_DIR).toBeUndefined();
      expect(env.REPO_ROOT).toBe("/repo");
    } finally {
      if (saved !== undefined) process.env.OMP_WORKTREE_DIR = saved;
    }
  });
});

describe("config file names", () => {
  test(".giwt.toml is honored when giwt.toml is absent", () => {
    const dir = join(TMP, "dotfile-only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".giwt.toml"), '[paths]\ntree = "dot-tree"\n');
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.available).toBe(true);
    expect(cfg.configFile).toBe(join(dir, ".giwt.toml"));
    expect(cfg.treeDir).toBe(join(dir, "dot-tree"));
  });

  test("giwt.toml wins over .giwt.toml when both exist", () => {
    const dir = join(TMP, "both-files");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "giwt.toml"), '[paths]\ntree = "plain-tree"\n');
    writeFileSync(join(dir, ".giwt.toml"), '[paths]\ntree = "dot-tree"\n');
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.configFile).toBe(join(dir, "giwt.toml"));
    expect(cfg.treeDir).toBe(join(dir, "plain-tree"));
  });

  test("configFile is null when no config file exists", () => {
    const dir = join(TMP, "no-config-file");
    mkdirSync(join(dir, ".tmp", "giwt"), { recursive: true });
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.available).toBe(true);
    expect(cfg.configFile).toBeNull();
  });
});

describe("omp dir placement", () => {
  test("defaults receipt to <root>/.omp/receipt.toml", () => {
    const dir = join(TMP, "omp-default");
    mkdirSync(dir, { recursive: true });
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.ompDir).toBe(join(dir, ".omp"));
    expect(cfg.receiptPath).toBe(join(dir, ".omp", "receipt.toml"));
    expect(resolveReceiptPath(dir)).toBe(join(dir, ".omp", "receipt.toml"));
  });

  test("paths.omp_dir relocates the receipt (e.g. .tmp)", () => {
    const dir = join(TMP, "omp-custom");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "giwt.toml"), '[paths]\nomp_dir = ".tmp/omp"\n');
    const cfg = resolveGiwtConfig(dir);
    expect(cfg.ompDir).toBe(join(dir, ".tmp", "omp"));
    expect(cfg.receiptPath).toBe(join(dir, ".tmp", "omp", "receipt.toml"));
    expect(resolveReceiptPath(dir)).toBe(join(dir, ".tmp", "omp", "receipt.toml"));
  });

  test("resolveReceiptPath returns undefined for undefined cwd", () => {
    expect(resolveReceiptPath(undefined)).toBeUndefined();
  });
});

describe("resolvePlanDir", () => {
  test("tickets honors paths.tickets; epics/backlog hang off paths.plan", () => {
    const dir = join(TMP, "plan-custom");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".giwt.toml"),
      '[paths]\nplan = "docs/plan"\ntickets = "docs/plan/work"\n',
    );
    expect(resolvePlanDir(dir, "tickets")).toBe(join(dir, "docs", "plan", "work"));
    expect(resolvePlanDir(dir, "epics")).toBe(join(dir, "docs", "plan", "epics"));
    expect(resolvePlanDir(dir, "backlog")).toBe(join(dir, "docs", "plan", "backlog"));
  });

  test("defaults preserve the .plan/* layout", () => {
    const dir = join(TMP, "plan-default");
    mkdirSync(dir, { recursive: true });
    expect(resolvePlanDir(dir, "tickets")).toBe(join(dir, ".plan", "tickets"));
    expect(resolvePlanDir(dir, "epics")).toBe(join(dir, ".plan", "epics"));
  });
});

describe("dumpGiwtConfig", () => {
  test("shows template when no config file exists", () => {
    const dir = join(TMP, "dump-none");
    mkdirSync(dir, { recursive: true });
    const out = dumpGiwtConfig(dir);
    expect(out).toContain("available: no");
    expect(out).toContain("none (using defaults)");
    expect(out).toContain("omp_dir");
    expect(out).toContain("receipt path:");
  });

  test("shows resolved values when a config file exists", () => {
    const dir = join(TMP, "dump-found");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".giwt.toml"),
      '[paths]\ntree = "wt"\nomp_dir = ".tmp/omp"\n[branches]\nroot = "main"\n',
    );
    const out = dumpGiwtConfig(dir);
    expect(out).toContain("available: yes");
    expect(out).toContain(".giwt.toml");
    expect(out).toContain(join(dir, "wt"));
    expect(out).toContain(join(dir, ".tmp", "omp", "receipt.toml"));
    expect(out).toContain("main");
  });
});
