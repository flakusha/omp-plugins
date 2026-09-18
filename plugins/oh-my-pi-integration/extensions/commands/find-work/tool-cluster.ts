/**
 * `/find-work` tool-cluster orchestration: one shared wall-clock budget
 * spent first on the doctor delegation, then on concurrent direct runners,
 * with every failure converted into a warning.
 */

import { DOCTOR_CHECKS, DOCTOR_TIMEOUT_MS, type DoctorCheck, fetchViaDoctor } from "./doctor";
import { TOOL_CLUSTER_BUDGET_MS } from "./keywords";
import { runJscpd, runKnip } from "./knip-jscpd";
import { runLintCluster } from "./lint";
import type { ExecLike, ToolCap } from "./tool-exec";
import { runTests, runTypecheck } from "./typecheck-tests";
import type { ToolFetch, WorkSources, WorkTicket } from "./types";

export interface ToolClusterOpts {
  /** Overall wall budget for doctor + fallback (test injection point). */
  budgetMs?: number;
}

/** Run one tool-cluster source, converting any failure into a warning. */
async function runGuarded(
  label: string,
  hint: string,
  run: () => Promise<WorkTicket[]>,
): Promise<{ tickets: WorkTicket[]; warning?: string }> {
  try {
    return { tickets: await run() };
  } catch {
    return { tickets: [], warning: `${label} scan failed (${hint})` };
  }
}

export async function fetchToolTickets(
  pi: ExecLike,
  root: string,
  sources: WorkSources,
  opts?: ToolClusterOpts,
): Promise<ToolFetch> {
  const budgetMs = opts?.budgetMs ?? TOOL_CLUSTER_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const wanted = new Set<DoctorCheck>(DOCTOR_CHECKS.filter((k) => sources[k]));
  // deadline > now guard: timeout 0 conventionally means "no timeout" in
  // exec surfaces — never hand an exhausted budget to the doctor call.
  if (wanted.size > 0 && deadline > Date.now()) {
    // Doctor's checks run sequentially inside giwt (spawnSync, no internal
    // timeouts). Cap it by the remaining cluster budget; when it consumes
    // the budget the direct fallback is skipped — it could not finish in
    // the leftover time either (see budget warning below).
    const remaining = deadline - Date.now();
    const via = await fetchViaDoctor(
      pi,
      root,
      wanted,
      Math.max(0, Math.min(DOCTOR_TIMEOUT_MS, remaining)),
    );
    if (via) return via;
  }
  const left = deadline - Date.now();
  if (left <= 0) {
    return {
      tickets: [],
      warnings: [
        `tool findings skipped: ${Math.round(budgetMs / 1000)}s cluster budget consumed by doctor check — run \`giwt doctor check\` directly for the full report`,
      ],
    };
  }
  // Direct fallback: independent tools, one subprocess each, run
  // concurrently; every per-tool timeout is capped by the budget left.
  const cap: ToolCap = (ms) => Math.min(ms, left);
  const jobs: Array<Promise<{ tickets: WorkTicket[]; warning?: string }>> = [];
  if (sources.lint) {
    jobs.push(
      runGuarded("lint", "linter not installed or timed out?", () => runLintCluster(pi, root, cap)),
    );
  }
  if (sources.typecheck) {
    jobs.push(
      runGuarded("typecheck", "tsc not installed or timed out?", () => runTypecheck(pi, root, cap)),
    );
  }
  if (sources.tests) {
    jobs.push(
      runGuarded("tests", "timed out? run the test command directly", () =>
        runTests(pi, root, cap),
      ),
    );
  }
  if (sources.knip) {
    jobs.push(runGuarded("knip", "knip not installed or timed out?", () => runKnip(pi, root, cap)));
  }
  if (sources.jscpd) {
    jobs.push(
      runGuarded("jscpd", "jscpd not installed or timed out?", () => runJscpd(pi, root, cap)),
    );
  }
  const tickets: WorkTicket[] = [];
  const warnings: string[] = [];
  for (const result of await Promise.all(jobs)) {
    tickets.push(...result.tickets);
    if (result.warning) warnings.push(result.warning);
  }
  return { tickets, warnings };
}
