import { afterEach, describe, expect, test } from "bun:test";
// Default import: the tracker patches the fs module surface, which is only
// visible through property access (named-import bindings are snapshotted
// at module instantiation, before any patch could land).
import nodeFs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  carry,
  carryReceipt,
  parseReceipt,
  RECEIPT_KEEP,
  RECEIPT_MAX_LINES,
  renderFooter,
  setEntryState,
} from "../receipt/receipt";
import {
  drainTmpWrites,
  installTmpWriteTracker,
  resetTmpWriteTracker,
  TMP_WRITE_TRACKER_MAX,
  tmpWriteTrackerInstalled,
} from "../util/tmp-write-tracker";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetTmpWriteTracker(); // tracker patches process-global fs/Bun surfaces
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const EXAMPLE = `[[job]]
# Feature
F-01 = "feature: make the cicd happy"
state = "finished"
[[job]]
F-02 = "improve database performance"
state = "in progress"
[[job]]
F-03 = "introduce e2e testing"
state = "postponed"
[[job]]
# Blocker
B-00 = "access to live db was restricted"

[[issue]]
tooling = "failed to access report.json"
[[issue]]
`;

describe("parseReceipt", () => {
  test("splits entries, captures id/state/blocker, and tolerates empty blocks", () => {
    const doc = parseReceipt(EXAMPLE);
    expect(doc.entries.map((e) => e.firstKey)).toEqual([
      "F-01",
      "F-02",
      "F-03",
      "B-00",
      "tooling",
      undefined,
    ]);
    expect(doc.entries[0]?.state).toBe("finished");
    expect(doc.entries[1]?.state).toBe("in progress");
    expect(doc.entries[3]?.blocker).toBe(true);
    expect(doc.entries[4]?.table).toBe("issue");
    expect(doc.n).toBe(0);
  });

  test("reads a pre-existing [carriage] counter", () => {
    const doc = parseReceipt('[carriage]\nn = 12\n\n[[job]]\nX-1 = "thing"\n');
    expect(doc.n).toBe(12);
    expect(doc.nLine).toBe(1);
    expect(doc.carriageLine).toBe(0);
  });

  test("unquotes basic strings and keeps unknown keys out of state/done_at", () => {
    const doc = parseReceipt('[[job]]\nA-1 = "say \\"hi\\""\nowner = "alice"\n');
    expect(doc.entries[0]?.firstKey).toBe("A-1");
    expect(doc.entries[0]?.state).toBeUndefined();
    expect(doc.entries[0]?.doneAt).toBeUndefined();
  });
});

describe("carry — chores", () => {
  test("bumps the counter and creates [carriage] when absent", () => {
    const r = carry(EXAMPLE);
    expect(r.n).toBe(1);
    expect(r.text).toContain("[carriage]\nn = 1");
    expect(r.text).toContain("# Feature"); // comments preserved
  });

  test("rewrites an existing counter in place", () => {
    const r = carry('[carriage]\nn = 10\n\n[[job]]\nX-1 = "thing"\n');
    expect(r.n).toBe(11);
    expect(r.text).toContain("n = 11");
    expect(r.text).not.toContain("n = 10");
  });

  test("stamps newly finished jobs with done_at", () => {
    const r = carry(EXAMPLE);
    expect(r.text).toContain('state = "finished"\ndone_at = 1');
  });

  test("finished jobs survive exactly RECEIPT_KEEP receipts, then are pruned", () => {
    let text = EXAMPLE;
    const footers: string[] = [];
    for (let i = 0; i < RECEIPT_KEEP + 3; i++) {
      const r = carry(text);
      text = r.text;
      footers.push(r.footer.join("\n"));
    }
    // carried on receipts 1..3, pruned on receipt 4
    expect(footers[0]).toContain("F-01");
    expect(footers[RECEIPT_KEEP - 1]).toContain("F-01");
    expect(footers[RECEIPT_KEEP]).not.toContain("F-01");
    expect(text).not.toContain("F-01");
    // everything else survives indefinitely
    expect(text).toContain("F-02");
    expect(text).toContain("F-03");
    expect(text).toContain("B-00");
    expect(text).toContain("tooling");
  });

  test("prunes empty blocks and preserves comments and unknown keys", () => {
    const r = carry(EXAMPLE);
    const blocks = r.text.split("\n").filter((l) => l === "[[issue]]");
    expect(blocks.length).toBe(1); // the empty second [[issue]] is gone
    expect(r.text).toContain("# Feature");
    expect(r.text).toContain("# Blocker");
  });

  test("is stable across repeated carries of an already-chored document", () => {
    const once = carry(EXAMPLE);
    const twice = carry(once.text);
    const thrice = carry(twice.text);
    // only the counter line differs between successive carries
    const strip = (t: string) =>
      t
        .split("\n")
        .filter((l) => !/^n = \d+$/.test(l) && !/^done_at = \d+$/.test(l))
        .join("\n");
    expect(strip(twice.text)).toBe(strip(thrice.text));
  });
});

describe("renderFooter", () => {
  test("emits one compact line per carried entry with state labels", () => {
    const doc = parseReceipt(EXAMPLE);
    doc.n = 7;
    const footer = renderFooter(doc);
    expect(footer[0]).toBe("[receipt n=7]");
    expect(footer).toContain("job finished F-01: feature: make the cicd happy");
    expect(footer).toContain("job (in progress) F-02: improve database performance");
    expect(footer).toContain("job (postponed) F-03: introduce e2e testing");
    expect(footer).toContain("job (in progress) [blocker] B-00: access to live db was restricted");
    expect(footer).toContain("issue tooling: failed to access report.json");
  });

  test("treats a missing state as in progress and skips empty blocks", () => {
    const footer = renderFooter(parseReceipt('[[job]]\nZ-9 = "bare job"\n[[issue]]\n'));
    expect(footer).toEqual(["[receipt n=0]", "job (in progress) Z-9: bare job"]);
  });
});

describe("carryReceipt — IO wiring", () => {
  test("injects a footer message and writes the chored document back", async () => {
    const cwd = tempDir("receipt-io-");
    mkdirSync(join(cwd, ".omp"));
    writeFileSync(join(cwd, ".omp", "receipt.toml"), EXAMPLE);
    const result = await carryReceipt(cwd, {});
    expect(result?.message.customType).toBe("omp-receipt");
    expect(result?.message.display).toBe(false);
    expect(result?.message.content).toContain("F-01");
    expect(result?.message.content).toContain("F-03");
    const written = readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8");
    expect(written).toContain("[carriage]");
    expect(written).toContain("done_at = 1");
    expect(written.endsWith(".tmp")).toBe(false);
  });

  test("returns undefined when no receipt exists, is disabled, or cwd is missing", async () => {
    expect(await carryReceipt(tempDir("receipt-empty-"), {})).toBeUndefined();
    const cwd = tempDir("receipt-off-");
    mkdirSync(join(cwd, ".omp"));
    writeFileSync(join(cwd, ".omp", "receipt.toml"), EXAMPLE);
    expect(await carryReceipt(cwd, { PI_RECEIPT_DISABLE: "1" })).toBeUndefined();
    expect(await carryReceipt(undefined, {})).toBeUndefined();
  });

  test("fail-open: malformed TOML tables leave the file untouched", async () => {
    const cwd = tempDir("receipt-bad-");
    mkdirSync(join(cwd, ".omp"));
    writeFileSync(join(cwd, ".omp", "receipt.toml"), "[[job]\nbroken");
    expect(await carryReceipt(cwd, {})).toBeUndefined();
    expect(readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8")).toBe("[[job]\nbroken");
  });

  test("a receipt with no entries carries nothing and is not rewritten", async () => {
    const cwd = tempDir("receipt-void-");
    mkdirSync(join(cwd, ".omp"));
    const text = "# nothing yet\n";
    writeFileSync(join(cwd, ".omp", "receipt.toml"), text);
    expect(await carryReceipt(cwd, {})).toBeUndefined();
    expect(readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8")).toBe(text);
  });

  test("carries giwt ledger alongside TOML receipt", async () => {
    const cwd = tempDir("receipt-giwt-both-");
    mkdirSync(join(cwd, ".omp"));
    writeFileSync(join(cwd, ".omp", "receipt.toml"), EXAMPLE);
    // giwt setup: giwt.toml + tree/.ledger.jsonl
    writeFileSync(join(cwd, "giwt.toml"), '[paths]\ntree = "tree"\n');
    mkdirSync(join(cwd, "tree"), { recursive: true });
    writeFileSync(
      join(cwd, "tree", ".ledger.jsonl"),
      `${JSON.stringify({
        v: 1,
        ts: "2026-09-10T06:55:01Z",
        pid: 1,
        cmd: "new",
        branch: "auth",
        msg: "new auth :: working on login",
      })}\n`,
    );
    const result = await carryReceipt(cwd, {});
    expect(result).toBeDefined();
    expect(result?.message.content).toContain("F-02"); // TOML job
    expect(result?.message.content).toContain("F-03"); // TOML job
    expect(result?.message.content).toContain("[giwt ledger]"); // giwt section
    expect(result?.message.content).toContain("new auth"); // giwt entry
    expect(result?.message.content).toContain(".omp/receipt.toml + .ledger.jsonl");
  });

  test("carries giwt ledger alone when no TOML receipt exists", async () => {
    const cwd = tempDir("receipt-giwt-only-");
    // No .omp/receipt.toml — only giwt
    writeFileSync(join(cwd, "giwt.toml"), '[paths]\ntree = "tree"\n');
    mkdirSync(join(cwd, "tree"), { recursive: true });
    writeFileSync(
      join(cwd, "tree", ".ledger.jsonl"),
      `${JSON.stringify({
        v: 1,
        ts: "2026-09-10T07:00:00Z",
        pid: 2,
        cmd: "commit",
        branch: "fix",
        msg: "commit fix :: done",
      })}\n`,
    );
    const result = await carryReceipt(cwd, {});
    expect(result).toBeDefined();
    expect(result?.message.content).toContain("[giwt ledger]");
    expect(result?.message.content).toContain("commit fix");
    expect(result?.message.content).toContain(".ledger.jsonl");
    expect(result?.message.content).not.toContain(".omp/receipt.toml");
  });

  test("honors paths.omp_dir for receipt placement (e.g. .tmp)", async () => {
    const cwd = tempDir("receipt-ompdir-");
    writeFileSync(join(cwd, "giwt.toml"), '[paths]\ntree = "tree"\nomp_dir = ".tmp/omp"\n');
    mkdirSync(join(cwd, ".tmp", "omp"), { recursive: true });
    writeFileSync(join(cwd, ".tmp", "omp", "receipt.toml"), EXAMPLE);
    // No .omp dir at all — the resolved location must be used.
    expect(existsSync(join(cwd, ".omp"))).toBe(false);
    const result = await carryReceipt(cwd, {});
    expect(result).toBeDefined();
    expect(result?.message.content).toContain("F-02");
    expect(result?.message.content).toContain(".tmp/omp/receipt.toml");
    const written = readFileSync(join(cwd, ".tmp", "omp", "receipt.toml"), "utf8");
    expect(written).toContain("[carriage]");
  });

  test("does not write TOML when only giwt has entries", async () => {
    const cwd = tempDir("receipt-giwt-nochurn-");
    mkdirSync(join(cwd, ".omp"));
    const text = "# nothing yet\n";
    writeFileSync(join(cwd, ".omp", "receipt.toml"), text);
    // giwt has entries, TOML does not
    writeFileSync(join(cwd, "giwt.toml"), '[paths]\ntree = "tree"\n');
    mkdirSync(join(cwd, "tree"), { recursive: true });
    writeFileSync(
      join(cwd, "tree", ".ledger.jsonl"),
      `${JSON.stringify({
        v: 1,
        ts: "2026-09-10T07:00:00Z",
        pid: 3,
        cmd: "test",
        branch: "",
        msg: "test run",
      })}\n`,
    );
    const result = await carryReceipt(cwd, {});
    expect(result).toBeDefined();
    expect(result?.message.content).toContain("[giwt ledger]");
    // TOML should NOT be written (no entries = no churn)
    expect(readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8")).toBe(text);
  });
});

describe("setEntryState", () => {
  test("rewrites the state line in place, preserving comments", () => {
    const next = setEntryState(EXAMPLE, "F-02", "finished");
    expect(next).toContain('F-02 = "improve database performance"\nstate = "finished"');
    expect(next).toContain("# Feature");
    expect(next).toContain('state = "postponed"');
  });

  test("appends a state line when the block has none", () => {
    const next = setEntryState(EXAMPLE, "B-00", "finished");
    expect(next).toContain('B-00 = "access to live db was restricted"\nstate = "finished"');
  });

  test("matches ids case-insensitively, returns undefined for unknown ids", () => {
    expect(setEntryState(EXAMPLE, "f-02", "finished")).toContain('state = "finished"');
    expect(setEntryState(EXAMPLE, "F-99", "finished")).toBeUndefined();
  });
});

describe("parseReceipt — session artifacts", () => {
  test("parses a top-level session_artifacts array and tracks its line", () => {
    const doc = parseReceipt(
      'session_artifacts = [".tmp/a", ".tmp/b"]\n\n[[job]]\nX-1 = "thing"\n',
    );
    expect(doc.sessionArtifacts).toEqual([".tmp/a", ".tmp/b"]);
    expect(doc.artifactsLine).toBe(0);
  });

  test("treats session_artifacts in the carriage region as carriage-level metadata", () => {
    const doc = parseReceipt(
      '[carriage]\nn = 2\nsession_artifacts = [".tmp/x"]\n\n[[job]]\nX-1 = "thing"\n',
    );
    expect(doc.sessionArtifacts).toEqual([".tmp/x"]);
    expect(doc.artifactsLine).toBe(2);
  });

  test("tolerates malformed arrays", () => {
    expect(parseReceipt("session_artifacts = [oops\n").sessionArtifacts).toEqual([]);
    expect(parseReceipt('session_artifacts = ".tmp/a"\n').sessionArtifacts).toEqual([]);
    expect(parseReceipt("session_artifacts = []\n").sessionArtifacts).toEqual([]);
  });

  test("session_artifacts inside a [[job]] block stays entry payload", () => {
    const doc = parseReceipt('[[job]]\nsession_artifacts = [".tmp/a"]\n');
    expect(doc.sessionArtifacts).toEqual([]);
    expect(doc.artifactsLine).toBe(-1);
    expect(doc.entries[0]?.firstKey).toBe("session_artifacts");
  });
});

describe("carry — session artifacts", () => {
  test("rewrites an existing session_artifacts line in place", () => {
    const before = 'session_artifacts = [".tmp/old", ".tmp/stale"]\n\n[[job]]\nX-1 = "thing"\n';
    const r = carry(before, RECEIPT_KEEP, [".tmp/a", ".tmp/b"]);
    expect(r.text.split("\n")[3]).toBe('session_artifacts = [".tmp/a", ".tmp/b"]');
    expect(r.text).not.toContain(".tmp/old");
    expect(r.text).toContain('X-1 = "thing"');
  });

  test("inserts the line under [carriage] when absent", () => {
    const r = carry('[[job]]\nX-1 = "thing"\n', RECEIPT_KEEP, [".tmp/a"]);
    expect(r.text).toContain('[carriage]\nn = 1\nsession_artifacts = [".tmp/a"]');
    expect(r.footer.some((l) => l.startsWith("artifacts: 1"))).toBe(true);
  });

  test("round-trips: the inserted line is re-parsed and replaced, never duplicated", () => {
    const once = carry('[[job]]\nX-1 = "thing"\n', RECEIPT_KEEP, [".tmp/a", ".tmp/b"]);
    const twice = carry(once.text); // no new artifacts: line stays, footer keeps it
    expect(twice.text).toContain('session_artifacts = [".tmp/a", ".tmp/b"]');
    expect(twice.footer.some((l) => l.startsWith("artifacts: 2"))).toBe(true);
    const thrice = carry(twice.text, RECEIPT_KEEP, [".tmp/c"]);
    expect(thrice.text.match(/session_artifacts/g)).toHaveLength(1);
    expect(thrice.text).toContain('session_artifacts = [".tmp/c"]');
  });

  test("empty artifacts leave a document without the key byte-identical (bump aside)", () => {
    const text = '[[job]]\nX-1 = "thing"\n';
    expect(carry(text, RECEIPT_KEEP, []).text).toBe(carry(text).text);
    expect(carry(text, RECEIPT_KEEP, []).text).not.toContain("session_artifacts");
  });

  test("empty artifacts leave an existing line untouched", () => {
    const r = carry(
      'session_artifacts = [".tmp/keep"]\n\n[[job]]\nX-1 = "thing"\n',
      RECEIPT_KEEP,
      [],
    );
    expect(r.text).toContain('session_artifacts = [".tmp/keep"]');
  });

  test("insertion lands on the real line even when chores prune blocks above", () => {
    const text =
      '[carriage]\nn = 5\n\n[[job]]\nD-1 = "done long ago"\nstate = "finished"\ndone_at = 3\n';
    const r = carry(text, RECEIPT_KEEP, [".tmp/a"]);
    expect(r.text).not.toContain("D-1");
    expect(r.text).not.toContain("done long ago");
    expect(r.text).toContain("n = 6");
    expect(r.text).toContain('session_artifacts = [".tmp/a"]');
  });
});

describe("renderFooter — session artifacts", () => {
  test("appends one artifacts summary line after the entry lines", () => {
    const doc = parseReceipt(
      'session_artifacts = [".tmp/a", ".tmp/b", ".tmp/c"]\n\n[[job]]\nX-1 = "thing"\n',
    );
    const footer = renderFooter(doc);
    expect(footer).toHaveLength(3);
    expect(footer[2]).toBe("artifacts: 3 (.tmp/a, .tmp/b, .tmp/c)");
  });

  test("truncates the path list to fit, keeping the count exact", () => {
    const paths = Array.from({ length: 40 }, (_, i) => `.tmp/very-long-artifact-name-${i}`);
    const doc = parseReceipt(`session_artifacts = [${paths.map((p) => `"${p}"`).join(", ")}]\n`);
    const line = renderFooter(doc).find((l) => l.startsWith("artifacts:"));
    expect(line?.startsWith("artifacts: 40 (")).toBe(true);
    expect(line?.endsWith(", …)")).toBe(true);
    expect((line ?? "").length).toBeLessThanOrEqual(120);
  });

  test("drops the artifacts line first when the footer would exceed RECEIPT_MAX_LINES", () => {
    const jobs = Array.from(
      { length: RECEIPT_MAX_LINES - 1 },
      (_, i) => `[[job]]\nJ-${i} = "job ${i}"\n`,
    ).join("");
    const doc = parseReceipt(`session_artifacts = [".tmp/a"]\n${jobs}`);
    const footer = renderFooter(doc);
    expect(footer).toHaveLength(RECEIPT_MAX_LINES);
    expect(footer.some((l) => l.startsWith("artifacts:"))).toBe(false);
    expect(footer.filter((l) => l.startsWith("job"))).toHaveLength(RECEIPT_MAX_LINES - 1);
  });

  test("keeps the artifacts line when it exactly fills the cap", () => {
    const jobs = Array.from(
      { length: RECEIPT_MAX_LINES - 2 },
      (_, i) => `[[job]]\nJ-${i} = "job ${i}"\n`,
    ).join("");
    const doc = parseReceipt(`session_artifacts = [".tmp/a"]\n${jobs}`);
    const footer = renderFooter(doc);
    expect(footer).toHaveLength(RECEIPT_MAX_LINES);
    expect(footer[footer.length - 1]).toBe("artifacts: 1 (.tmp/a)");
  });
});

describe("carryReceipt — session artifacts wiring", () => {
  test("passes tmp writes into the TOML carry and footer", async () => {
    const cwd = tempDir("receipt-artifacts-");
    mkdirSync(join(cwd, ".omp"));
    writeFileSync(join(cwd, ".omp", "receipt.toml"), '[[job]]\nJ-1 = "scratch files"\n');
    const result = await carryReceipt(cwd, {}, [".tmp/a", ".tmp/b"]);
    const written = readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8");
    expect(written).toContain('session_artifacts = [".tmp/a", ".tmp/b"]');
    expect(result?.message.content).toContain("artifacts: 2 (.tmp/a, .tmp/b)");
  });

  test("disabled receipt ignores tmp writes entirely", async () => {
    const cwd = tempDir("receipt-artifacts-off-");
    mkdirSync(join(cwd, ".omp"));
    writeFileSync(join(cwd, ".omp", "receipt.toml"), '[[job]]\nJ-1 = "scratch files"\n');
    expect(await carryReceipt(cwd, { PI_RECEIPT_DISABLE: "1" }, [".tmp/a"])).toBeUndefined();
    expect(readFileSync(join(cwd, ".omp", "receipt.toml"), "utf8")).not.toContain(
      "session_artifacts",
    );
  });
});

describe("tmp write tracker", () => {
  // Resource contract: each test owns a unique mkdtemp root; the tracker
  // itself patches process-global fs/Bun surfaces, so every test resets it
  // via the file-wide afterEach (parallel files must not rely on patch state).
  test("records .tmp writes across patched fs APIs in write order, deduped", () => {
    const root = tempDir("tracker-root-");
    installTmpWriteTracker(root);
    expect(tmpWriteTrackerInstalled()).toBe(true);
    mkdirSync(join(root, ".tmp"), { recursive: true });
    nodeFs.writeFileSync(join(root, ".tmp", "a"), "A");
    nodeFs.appendFileSync(join(root, ".tmp", "b"), "B");
    nodeFs.writeFile(join(root, ".tmp", "c"), "C", () => {});
    nodeFs.writeFileSync(join(root, ".tmp", "a"), "A2"); // dedup: same destination
    nodeFs.writeFileSync(join(root, "outside.txt"), "no"); // outside .tmp/
    nodeFs.writeFileSync("/tmp/tracker-elsewhere.txt", "no"); // outside the root
    expect(drainTmpWrites()).toEqual([".tmp/a", ".tmp/b", ".tmp/c"]);
    expect(drainTmpWrites()).toEqual([]);
  });

  test("records renameSync destinations, not sources", () => {
    const root = tempDir("tracker-rename-");
    installTmpWriteTracker(root);
    mkdirSync(join(root, ".tmp"), { recursive: true });
    nodeFs.writeFileSync(join(root, ".tmp", "d.part"), "D");
    drainTmpWrites();
    nodeFs.renameSync(join(root, ".tmp", "d.part"), join(root, ".tmp", "d"));
    expect(drainTmpWrites()).toEqual([".tmp/d"]);
  });

  test("records Bun.write destinations", async () => {
    const root = tempDir("tracker-bun-");
    installTmpWriteTracker(root);
    mkdirSync(join(root, ".tmp"), { recursive: true });
    await Bun.write(join(root, ".tmp", "e"), "E");
    expect(drainTmpWrites()).toEqual([".tmp/e"]);
  });

  test("double install is a no-op and reset restores passthrough", () => {
    const root = tempDir("tracker-idem-");
    installTmpWriteTracker(root);
    const wrapped = nodeFs.writeFileSync;
    installTmpWriteTracker(root); // idempotent: same wrapper, no re-wrap
    expect(nodeFs.writeFileSync).toBe(wrapped);
    mkdirSync(join(root, ".tmp"), { recursive: true });
    nodeFs.writeFileSync(join(root, ".tmp", "f"), "F");
    expect(drainTmpWrites()).toEqual([".tmp/f"]);
    resetTmpWriteTracker();
    expect(tmpWriteTrackerInstalled()).toBe(false);
    nodeFs.writeFileSync(join(root, ".tmp", "g"), "G");
    expect(drainTmpWrites()).toEqual([]);
  });

  test("PI_RECEIPT_DISABLE=1 at install time skips patching", () => {
    const prev = process.env.PI_RECEIPT_DISABLE;
    process.env.PI_RECEIPT_DISABLE = "1";
    try {
      const root = tempDir("tracker-off-");
      installTmpWriteTracker(root);
      expect(tmpWriteTrackerInstalled()).toBe(false);
      mkdirSync(join(root, ".tmp"), { recursive: true });
      nodeFs.writeFileSync(join(root, ".tmp", "h"), "H");
      expect(drainTmpWrites()).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.PI_RECEIPT_DISABLE;
      else process.env.PI_RECEIPT_DISABLE = prev;
    }
  });

  test("caps recorded paths at the tracker maximum", () => {
    const root = tempDir("tracker-cap-");
    installTmpWriteTracker(root);
    mkdirSync(join(root, ".tmp"), { recursive: true });
    for (let i = 0; i < TMP_WRITE_TRACKER_MAX + 5; i++) {
      nodeFs.writeFileSync(join(root, ".tmp", `f${i}`), "x");
    }
    const drained = drainTmpWrites();
    expect(drained).toHaveLength(TMP_WRITE_TRACKER_MAX);
    expect(drained[0]).toBe(".tmp/f0"); // first-seen order kept
  });

  test("end to end: tracked writes land in receipt.toml and drain once", async () => {
    const root = tempDir("tracker-e2e-");
    installTmpWriteTracker(root);
    mkdirSync(join(root, ".tmp"), { recursive: true });
    mkdirSync(join(root, ".omp"));
    writeFileSync(join(root, ".omp", "receipt.toml"), '[[job]]\nJ-1 = "scratch files"\n');
    nodeFs.writeFileSync(join(root, ".tmp", "a"), "A");
    nodeFs.appendFileSync(join(root, ".tmp", "b"), "B");
    await new Promise<void>((res, rej) =>
      nodeFs.writeFile(join(root, ".tmp", "c"), "C", (err) => (err ? rej(err) : res())),
    );
    const drained = drainTmpWrites();
    expect(drained).toEqual([".tmp/a", ".tmp/b", ".tmp/c"]);
    const result = await carryReceipt(root, {}, drained);
    const written = readFileSync(join(root, ".omp", "receipt.toml"), "utf8");
    expect(written).toContain('session_artifacts = [".tmp/a", ".tmp/b", ".tmp/c"]');
    expect(result?.message.content).toContain("artifacts: 3 (.tmp/a, .tmp/b, .tmp/c)");
    expect(drainTmpWrites()).toEqual([]); // the receipt write lives outside .tmp/
  });
});
