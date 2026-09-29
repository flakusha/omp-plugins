import { describe, expect, test } from "bun:test";
import { main as checkCoverageMain } from "../check-coverage";
import { main as checkNoConsoleMain } from "../check-no-console";
import { main as checkRegexSafetyMain } from "../check-regex-safety";
import { main as checkRulesSyncMain } from "../check-rules-sync";
import { main as checkShipmentMain } from "../check-shipment";

// In-process main() invocations: spawned subprocesses never credit the
// suite's lcov, so the only way the gate flows themselves count toward
// coverage is to run them here. check-coverage's own main() spawns the test
// suite — under the coverage gate's nested run (OMP_COVERAGE_CHILD=1) that
// would recurse, so it is skipped there.

describe("checker main() flows (in-process coverage)", () => {
  test("check-shipment passes on the repo", async () => {
    expect(await checkShipmentMain()).toBe(0);
  }, 30000);

  test("check-rules-sync passes on the repo", async () => {
    expect(await checkRulesSyncMain([])).toBe(0);
  }, 30000);

  test("check-no-console passes on the repo", async () => {
    expect(await checkNoConsoleMain()).toBe(0);
  }, 30000);

  test("check-regex-safety passes on the repo", async () => {
    expect(await checkRegexSafetyMain()).toBe(0);
  }, 30000);
});

describe("check-coverage main() usage", () => {
  // No spawn: arg parsing returns before the suite is launched, so this stays
  // unguarded and still runs inside the coverage child's own suite run.
  test("rejects unknown flags with usage", async () => {
    expect(await checkCoverageMain(["--wat"])).toBe(2);
  });
});

// verify's only test execution is the coverage gate's spawned run, so this
// spawning gate test would never run anywhere if left unguarded. Keeping the
// skip means the one suite execution verify performs is the one that runs it.
const describeGate = describe.skipIf(process.env.OMP_COVERAGE_CHILD === "1");

describeGate("check-coverage main() gate", () => {
  test("passes under a permissive minimum and fails under an impossible one", async () => {
    expect(await checkCoverageMain(["--min=0"])).toBe(0);
    expect(await checkCoverageMain(["--min=100"])).toBe(1);
  }, 120000);
});
