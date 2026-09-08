// Shared CLI smoke-test helper: runs a scripts/*.ts checker as a real `bun` child
// process. `root` maps to the checkers' OMP_CHECKS_ROOT repo-root override.
import { join } from "node:path";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  script: string,
  args: readonly string[] = [],
  opts: { root?: string; cwd?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  const scriptPath = join(import.meta.dir, "..", script);
  const env: Record<string, string | undefined> = { ...process.env, ...opts.env };
  if (opts.root !== undefined) env.OMP_CHECKS_ROOT = opts.root;
  const proc = Bun.spawn([process.execPath, scriptPath, ...args], {
    cwd: opts.cwd ?? import.meta.dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
