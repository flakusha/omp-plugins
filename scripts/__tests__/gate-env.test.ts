// The pre-commit hook runs the gate from inside a live agent session, so it
// launches every gate command through a stripped environment assembled by a
// sourced POSIX sh file. These tests drive that real file inside a real `sh`
// child with a real `bun` grandchild: a shell-level regression (lost prefix,
// broken word splitting) would otherwise surface only as a strange gate
// verdict on somebody's commit.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOOKS_DIR = join(import.meta.dir, "..", "..", ".githooks");
const GATE_ENV_SH = join(HOOKS_DIR, "gate-env.sh");
const PRE_COMMIT = join(HOOKS_DIR, "pre-commit");

const HARNESS_VARS = ["OMP_SESSION_ID", "PI_MODEL", "ENGRAM_PROJECT_ROOT", "MNEMO_MEMORY_URL"];
// OMPONENT_ shares letters with OMP_ but is not the prefix; a greedy substring
// strip would eat it, and PATH/HOME are what every spawned tool needs to work.
const SURVIVORS = ["PATH", "HOME", "OMPONENT_X"];
// Every variable under test must be SEEDED here. Asserting a var is undefined
// that was never in the environment passes even when the prefix is dropped
// from the strip set — the test would prove nothing.
const SEED: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: "/tmp/gate-env-home",
  OMPONENT_X: "keep-me",
  OMP_SESSION_ID: "seeded-omp",
  PI_MODEL: "seeded-pi",
  ENGRAM_PROJECT_ROOT: "/tmp/seeded-engram",
  MNEMO_MEMORY_URL: "http://seeded-mnemo.invalid",
};

function probeScript(names: readonly string[]): string {
  const list = JSON.stringify(names);
  return `for (const n of ${list}) process.stdout.write(n + "=" + (process.env[n] ?? "STRIPPED") + "\\n");`;
}

/** Sprints the given names as seen by a child launched the way the hook launches gates. */
async function runUnderGateEnv(names: readonly string[]): Promise<Record<string, string>> {
  // $1..$3 keep the paths and the probe out of the shell's word split.
  const script = `. "$1"\n$GATE_ENV "$2" -e "$3"\n`;
  const proc = Bun.spawn(
    ["sh", "-c", script, "gate-env-test", GATE_ENV_SH, process.execPath, probeScript(names)],
    {
      env: { ...SEED },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  // A non-zero exit would mean the stripped environment stopped the gate from
  // running at all — the failure mode that matters more than any missing var.
  expect({ code, stdout }).toEqual({ code: 0, stdout: expect.any(String) });
  const seen: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    seen[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
  }
  return seen;
}

/** Same probe without the gate env — proves the seeded vars really do arrive. */
async function runBare(names: readonly string[]): Promise<Record<string, string>> {
  const proc = Bun.spawn([process.execPath, "-e", probeScript(names)], {
    env: { ...SEED },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const seen: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    seen[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
  }
  return seen;
}

describe(".githooks/gate-env.sh behaviour", () => {
  test("strips every seeded harness family end to end", async () => {
    const bare = await runBare(HARNESS_VARS);
    expect(bare.OMP_SESSION_ID).toBe("seeded-omp");
    expect(bare.PI_MODEL).toBe("seeded-pi");

    const seen = await runUnderGateEnv(HARNESS_VARS);
    for (const name of HARNESS_VARS) expect({ [name]: seen[name] }).toEqual({ [name]: "STRIPPED" });
  });

  test("does not over-strip: PATH, HOME and a prefix lookalike survive", async () => {
    const seen = await runUnderGateEnv(SURVIVORS);
    expect(seen.PATH).toBe(SEED.PATH);
    expect(seen.HOME).toBe(SEED.HOME);
    expect(seen.OMPONENT_X).toBe(SEED.OMPONENT_X);
  });

  test("still drops GIT_* left behind by git's hook environment", async () => {
    const proc = Bun.spawn(
      [
        "sh",
        "-c",
        `. "$1"\n$GATE_ENV "$2" -e "$3"\n`,
        "gate-env-test",
        GATE_ENV_SH,
        process.execPath,
        probeScript(["GIT_DIR"]),
      ],
      { env: { ...SEED, GIT_DIR: "/tmp/not-this-repo" }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect({ code, stdout }).toEqual({ code: 0, stdout: "GIT_DIR=STRIPPED\n" });
  });
});

describe("stripped set is defined in one place", () => {
  const gateEnv = readFileSync(GATE_ENV_SH, "utf8");
  const hook = readFileSync(PRE_COMMIT, "utf8");

  test("gate-env.sh carries all four harness prefixes", () => {
    for (const prefix of ["OMP_", "PI_", "ENGRAM_", "MNEMO_"]) expect(gateEnv).toContain(prefix);
  });

  test("gate-env.sh carries the explicit GIT_* names", () => {
    for (const name of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_COMMON_DIR",
      "GIT_QUARANTINE_PATH",
    ]) {
      expect(gateEnv).toContain(name);
    }
  });

  test("pre-commit sources it instead of inlining an -u list", () => {
    expect(hook).toContain("gate-env.sh");
    expect(hook).not.toMatch(/-u GIT_/);
    expect(hook).not.toMatch(/^GATE_ENV=/m);
  });

  test("both files are valid POSIX shell", async () => {
    for (const file of [PRE_COMMIT, GATE_ENV_SH]) {
      const proc = Bun.spawn(["sh", "-n", file], { stdout: "pipe", stderr: "pipe" });
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect({ file, code, stderr }).toEqual({ file, code: 0, stderr: "" });
    }
  });
});
