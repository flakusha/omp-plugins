import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carry, carryReceipt, parseReceipt, RECEIPT_KEEP, renderFooter } from "../receipt/receipt";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
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
});
