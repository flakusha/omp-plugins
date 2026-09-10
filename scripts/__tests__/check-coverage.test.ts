import { describe, expect, test } from "bun:test";
import {
  collapseGaps,
  MIN_LINE_COVERAGE,
  summarizeLcov,
  TARGET_LINE_COVERAGE,
} from "../check-coverage";

const LCOV_SAMPLE = `TN:
SF:src/a.ts
DA:1,1
DA:2,0
DA:3,0
DA:4,5
LF:4
LH:2
FNF:2
FNH:1
end_of_record
TN:
SF:src/b.ts
DA:10,1
LF:1
LH:1
end_of_record
`;

describe("collapseGaps", () => {
  test("collapses consecutive lines into inclusive runs", () => {
    expect(collapseGaps([3, 4, 5, 9, 11, 12])).toEqual([
      [3, 5],
      [9, 9],
      [11, 12],
    ]);
  });

  test("returns empty for fully covered files", () => {
    expect(collapseGaps([])).toEqual([]);
  });
});

describe("summarizeLcov", () => {
  test("aggregates per-file coverage and global percentage", () => {
    const summary = summarizeLcov(LCOV_SAMPLE);
    expect(summary.files).toHaveLength(2);
    // sorted ascending by covered ratio
    expect(summary.files[0]?.path).toBe("src/a.ts");
    expect(summary.files[0]?.linesHit).toBe(2);
    expect(summary.files[0]?.linesTotal).toBe(4);
    expect(summary.files[0]?.funcsHit).toBe(1);
    expect(summary.files[0]?.funcsTotal).toBe(2);
    expect(summary.files[0]?.gaps).toEqual([[2, 3]]);
    expect(summary.files[1]?.path).toBe("src/b.ts");
    expect(summary.globalPct).toBeCloseTo((3 / 5) * 100);
  });

  test("falls back to DA aggregates when LF/LH are absent", () => {
    const summary = summarizeLcov("SF:x.ts\nDA:1,1\nDA:2,0\nend_of_record\n");
    expect(summary.files[0]?.linesHit).toBe(1);
    expect(summary.files[0]?.linesTotal).toBe(2);
  });

  test("skips records without SF or DA lines", () => {
    expect(summarizeLcov("TN:\nend_of_record\nSF:no-da.ts\nend_of_record\n").files).toEqual([]);
  });

  test("yields zero percent for an empty tracefile", () => {
    expect(summarizeLcov("").globalPct).toBe(0);
  });
});

describe("ratchet constants", () => {
  test("ratchet sits between the old floor and the 100% target", () => {
    expect(MIN_LINE_COVERAGE).toBeGreaterThan(73);
    expect(MIN_LINE_COVERAGE).toBeLessThanOrEqual(TARGET_LINE_COVERAGE);
  });

  test("target is full coverage", () => {
    expect(TARGET_LINE_COVERAGE).toBe(100);
  });
});
