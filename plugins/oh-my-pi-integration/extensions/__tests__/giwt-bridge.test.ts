import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatGiwtLedgerFooter,
  readGiwtLedger,
  resolveGiwtLedgerPath,
} from "../receipt/giwt-bridge";

const TMP = join(tmpdir(), `giwt-bridge-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });

afterAll(() => {
  try {
    require("node:fs").rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("readGiwtLedger", () => {
  test("returns [] when ledger file missing", () => {
    const dir = join(TMP, "no-ledger");
    mkdirSync(dir, { recursive: true });
    expect(readGiwtLedger(dir)).toEqual([]);
  });

  test("returns [] when ledger is empty", () => {
    const dir = join(TMP, "empty-ledger");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".ledger.jsonl"), "");
    expect(readGiwtLedger(dir)).toEqual([]);
  });

  test("parses valid JSONL records newest-first", () => {
    const dir = join(TMP, "valid-ledger");
    mkdirSync(dir, { recursive: true });
    const records = [
      JSON.stringify({
        v: 1,
        ts: "2026-09-10T06:55:01Z",
        pid: 1234,
        cmd: "new",
        branch: "foo",
        msg: "new foo :: working on auth",
      }),
      JSON.stringify({
        v: 1,
        ts: "2026-09-10T07:00:00Z",
        pid: 1235,
        cmd: "commit",
        branch: "foo",
        msg: "commit foo :: done",
      }),
    ];
    writeFileSync(join(dir, ".ledger.jsonl"), `${records.join("\n")}\n`);
    const entries = readGiwtLedger(dir);
    expect(entries.length).toBe(2);
    // Newest first (reversed)
    expect(entries[0].cmd).toBe("commit");
    expect(entries[1].cmd).toBe("new");
    expect(entries[0].id).toBe("GL-01");
    expect(entries[1].id).toBe("GL-02");
    expect(entries[0].state).toBe("observed");
  });

  test("skips corrupt lines", () => {
    const dir = join(TMP, "corrupt-ledger");
    mkdirSync(dir, { recursive: true });
    const lines = [
      "not json at all",
      JSON.stringify({
        v: 1,
        ts: "2026-09-10T06:55:01Z",
        pid: 1,
        cmd: "new",
        branch: "x",
        msg: "new x",
      }),
      "{ broken json",
    ];
    writeFileSync(join(dir, ".ledger.jsonl"), `${lines.join("\n")}\n`);
    const entries = readGiwtLedger(dir);
    expect(entries.length).toBe(1);
    expect(entries[0].cmd).toBe("new");
  });

  test("respects maxEntries cap", () => {
    const dir = join(TMP, "capped-ledger");
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      lines.push(
        JSON.stringify({
          v: 1,
          ts: `2026-09-10T06:${i}:00Z`,
          pid: i,
          cmd: "test",
          branch: "",
          msg: `run ${i}`,
        }),
      );
    }
    writeFileSync(join(dir, ".ledger.jsonl"), `${lines.join("\n")}\n`);
    const entries = readGiwtLedger(dir, 5);
    expect(entries.length).toBe(5);
  });
});

describe("formatGiwtLedgerFooter", () => {
  test("returns [] for empty entries", () => {
    expect(formatGiwtLedgerFooter([])).toEqual([]);
  });

  test("formats entries with header and truncation", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `GL-${String(i + 1).padStart(2, "0")}`,
      table: "job" as const,
      state: "observed" as const,
      summary: `run ${i}`,
      ts: `2026-09-10T06:${i}:00Z`,
      cmd: "test",
      branch: "feature",
      pid: 1000 + i,
    }));
    const lines = formatGiwtLedgerFooter(entries);
    expect(lines[0]).toBe("[giwt ledger]");
    expect(lines.length).toBe(14); // header + 12 entries + "more"
    expect(lines[lines.length - 1]).toContain("more");
  });
});

describe("resolveGiwtLedgerPath", () => {
  test("returns undefined when no ledger exists", () => {
    const dir = join(TMP, "no-ledger-path");
    mkdirSync(dir, { recursive: true });
    expect(resolveGiwtLedgerPath(dir)).toBeUndefined();
  });

  test("returns path when ledger exists in tree/", () => {
    const dir = join(TMP, "has-ledger-path");
    mkdirSync(join(dir, "tree"), { recursive: true });
    writeFileSync(join(dir, "tree", ".ledger.jsonl"), '{"v":1}\n');
    expect(resolveGiwtLedgerPath(dir)).toBe(join(dir, "tree", ".ledger.jsonl"));
  });
});
