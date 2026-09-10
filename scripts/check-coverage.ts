// check-coverage.ts — unit-test coverage gate for the bundle's own source.
//
// Runs the suite with lcov output, aggregates per-file and global LINE
// coverage, and fails when global line coverage drops below the minimum.
// The default minimum is a RATCHET pinned at the level measured when this
// gate landed (see MIN_LINE_COVERAGE); raise it as gaps close — the epic
// target is 90. The worst files and their uncovered line ranges are always
// printed so the next test to write is obvious.
//
// Exit codes: 0 pass / 1 under minimum or malformed lcov / 2 usage.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

/**
 * Global line-coverage ratchet (lcov metric: every instrumented line in every
 * suite-loaded file). Raised to 93 after landing handler-wiring tests for
 * extensions/index.ts and in-process checker main() tests (measured 93.98 on
 * 2026-09-10). Remaining known gap: scripts/check-coverage.ts main() itself
 * (covered only outside the gate's nested run). Raise toward 100 as gaps
 * close; never lower without cause.
 */
export const MIN_LINE_COVERAGE = 93;
export const TARGET_LINE_COVERAGE = 100;

export interface FileCoverage {
  path: string;
  linesHit: number;
  linesTotal: number;
  funcsHit: number;
  funcsTotal: number;
  /** Uncovered line ranges collapsed into runs, ascending. */
  gaps: Array<[number, number]>;
}

export interface CoverageSummary {
  files: FileCoverage[];
  globalPct: number;
}

/** Collapse ascending uncovered line numbers into inclusive runs. */
export function collapseGaps(uncovered: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const line of uncovered) {
    const last = runs[runs.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else runs.push([line, line]);
  }
  return runs;
}

/** Parse a single lcov record (one file's coverage) or null when not a file record. */
function parseRecord(record: string): FileCoverage | null {
  const sf = /^SF:(.+)$/m.exec(record);
  if (!sf?.[1]) return null;
  const da = [...record.matchAll(/^DA:(\d+),(\d+)$/gm)];
  if (da.length === 0) return null;

  const uncovered: number[] = [];
  let hit = 0;
  for (const m of da) {
    if (Number(m[2]) > 0) hit += 1;
    else uncovered.push(Number(m[1]));
  }
  const lf = /^LF:(\d+)$/m.exec(record);
  const lh = /^LH:(\d+)$/m.exec(record);
  const fnf = /^FNF:(\d+)$/m.exec(record);
  const fnh = /^FNH:(\d+)$/m.exec(record);

  return {
    path: sf[1].trim(),
    linesHit: lh ? Number(lh[1]) : hit,
    linesTotal: lf ? Number(lf[1]) : da.length,
    funcsHit: fnh ? Number(fnh[1]) : 0,
    funcsTotal: fnf ? Number(fnf[1]) : 0,
    gaps: collapseGaps(uncovered),
  };
}

/** Parse one lcov tracefile into per-file coverage + a global percentage. */
export function summarizeLcov(text: string): CoverageSummary {
  const files: FileCoverage[] = [];
  let globalHit = 0;
  let globalTotal = 0;

  for (const record of text.split("end_of_record")) {
    const file = parseRecord(record);
    if (!file) continue;
    globalHit += file.linesHit;
    globalTotal += file.linesTotal;
    files.push(file);
  }

  files.sort((a, b) => a.linesHit / a.linesTotal - b.linesHit / b.linesTotal);
  const globalPct = globalTotal === 0 ? 0 : (100 * globalHit) / globalTotal;
  return { files, globalPct };
}

function fmtPct(pct: number): string {
  return pct.toFixed(2);
}

function formatGaps(gaps: Array<[number, number]>, max = 4): string {
  return gaps
    .slice(0, max)
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
    .join(", ");
}

export async function main(argv: readonly string[]): Promise<number> {
  let min = MIN_LINE_COVERAGE;
  for (const arg of argv) {
    const m = /^--min=(\d+(?:\.\d+)?)$/.exec(arg);
    if (m) min = Number(m[1]);
    else {
      process.stderr.write(`usage: check-coverage [--min=<pct>]\n`);
      return 2;
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "coverage-check-"));
  try {
    const proc = Bun.spawn(
      [process.execPath, "test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${dir}`],
      {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        // Marker for the spawned suite: checker-CLI tests skip themselves so
        // spawning the suite under this gate cannot recurse into it.
        env: { ...process.env, OMP_COVERAGE_CHILD: "1" },
      },
    );
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code !== 0) {
      process.stderr.write(
        `ERROR: test suite failed (exit ${code}); coverage gate not evaluated\n`,
      );
      process.stderr.write(`${out}${err}`);
      return 1;
    }

    const lcovPath = join(dir, "lcov.info");
    let text: string;
    try {
      text = readFileSync(lcovPath, "utf8");
    } catch {
      process.stderr.write(`ERROR: no lcov.info produced at ${lcovPath}\n`);
      return 1;
    }

    const summary = summarizeLcov(text);
    if (summary.files.length === 0) {
      process.stderr.write(`ERROR: lcov.info contained no coverage records\n`);
      return 1;
    }

    console.log(
      `==> coverage check (global lines: ${fmtPct(summary.globalPct)}%, minimum: ${min}%)`,
    );
    const worst = summary.files.filter(
      (f) => 100 * (f.linesHit / f.linesTotal) < TARGET_LINE_COVERAGE,
    );
    for (const f of worst) {
      const pct = fmtPct(100 * (f.linesHit / f.linesTotal));
      console.log(
        `    ${pct}% lines (${f.linesHit}/${f.linesTotal}) ${f.path}  gaps: ${formatGaps(f.gaps)}`,
      );
    }

    if (summary.globalPct < min) {
      process.stderr.write(
        `ERROR: global line coverage ${fmtPct(summary.globalPct)}% is below the ${min}% minimum. ` +
          `Close gaps above or lower --min only with cause (ratchet must trend toward ${TARGET_LINE_COVERAGE}%).\n`,
      );
      return 1;
    }
    if (summary.globalPct < TARGET_LINE_COVERAGE) {
      console.log(
        `    ratchet OK — ${(TARGET_LINE_COVERAGE - summary.globalPct).toFixed(2)} points to ${TARGET_LINE_COVERAGE}% target`,
      );
    } else {
      console.log(`    coverage target ${TARGET_LINE_COVERAGE}% met`);
    }
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
