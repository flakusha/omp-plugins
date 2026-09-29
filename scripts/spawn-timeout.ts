// spawn-timeout.ts — bounded Bun.spawn wrapper for the check-runner gates.
//
// Every gate spawn goes through here so the deadline lives in one place. A
// wedged child (a hung `bun test`, an installer blocked on a prompt or a
// filesystem lock) never resolves, which hangs `bun run verify` and the
// pre-commit gate forever with no diagnostic and no kill path.
//
// Timeout is returned as a discriminated result, not thrown: the ordinary
// timeout path is a gate FAILURE whose exit code the owning check owns.

/** Shared deadline for gate subprocesses. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore" | "inherit";
  /** Gate name, reported in the timeout message. */
  gate: string;
  /** Overrides DEFAULT_TIMEOUT_MS for a slower gate. */
  timeoutMs?: number;
}

export interface SpawnCompleted {
  ok: true;
  code: number;
  stdout: string;
  stderr: string;
}

export interface SpawnTimedOut {
  ok: false;
  gate: string;
  /** The budget the child blew, for the failure message. */
  timeoutMs: number;
  /** Wall time actually waited before the kill. */
  elapsedMs: number;
  /** Dead child, kept so callers/tests can assert the kill landed. */
  pid: number;
}

export type SpawnOutcome = SpawnCompleted | SpawnTimedOut;

/** Pure so the failure text is unit-testable without spawning anything. */
export function formatTimeoutMessage(gate: string, budgetMs: number): string {
  return (
    `gate '${gate}' exceeded its ${budgetMs}ms budget — child process ` +
    `killed (raise the budget only with cause)`
  );
}

// Uint8Array<ArrayBuffer>, not the bare Uint8Array (= Uint8Array<ArrayBufferLike>): Bun's
// Subprocess streams are declared over the ArrayBuffer-backed chunk, and the two
// ReadableStreamDefaultReader declarations are only compatible at that concrete buffer.
type SpawnByte = Uint8Array<ArrayBuffer>;

/**
 * Structural reader shape. The lib copies in play declare two incompatible
 * ReadableStreamDefaultReaders (@types/node's stream/web copy, and the one Bun's
 * Subprocess is declared against), so naming the global picks the wrong one; readAll
 * only ever calls read().
 */
interface ByteReader {
  read(): Promise<{ done?: boolean; value?: Uint8Array }>;
}

async function readAll(reader: ByteReader): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    if (value) text += decoder.decode(value, { stream: true });
  }
}

export async function spawnWithTimeout(
  cmd: readonly string[],
  options: SpawnOptions,
): Promise<SpawnOutcome> {
  const { gate, timeoutMs = DEFAULT_TIMEOUT_MS, ...spawnOpts } = options;
  const started = Date.now();
  // detached => setsid => the child leads its own process group, so the
  // negative-pid kill below also reaches the installer's own subprocesses.
  // Bun's Subprocess.kill() signals only the direct child and orphans its
  // grandchildren, which is exactly the hang this wrapper must end.
  // SpawnOptions is declared pipe-piped: the ReadableToIO generics only resolve
  // to streams for "pipe", and the drain below branches on the handle anyway.
  const proc = Bun.spawn([...cmd], {
    ...spawnOpts,
    stdout: spawnOpts.stdout ?? "pipe",
    stderr: spawnOpts.stderr ?? "pipe",
    detached: true,
  } as Bun.SpawnOptions.OptionsObject<"ignore", "pipe", "pipe">);
  // Drain concurrently with the wait: a child that fills the 64KiB pipe buffer
  // blocks on write and would never exit if we only read after `exited`.
  const readers = [proc.stdout, proc.stderr]
    .filter((s): s is ReadableStream<SpawnByte> => s !== undefined)
    .map((s) => s.getReader());
  // Promise.all over a filtered array widens to string[]; the empty-string defaults
  // below are what make noUncheckedIndexedAccess agree that both are strings.
  const drain = Promise.all(readers.map(readAll));
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // ESRCH: the child exited between the deadline and the kill — nothing to reap.
    }
    // Drop our end of the pipes: a grandchild that called setsid() escapes the
    // group kill but keeps the write end open, and an undrained read keeps this
    // process alive on it — the same indefinite hang, one level up.
    for (const reader of readers) void reader.cancel().catch(() => {});
  }, timeoutMs);
  const code = await proc.exited;
  clearTimeout(deadline);
  if (timedOut) {
    // Drain is abandoned on purpose: its promise may never settle if a killed
    // child's pipe was inherited by a survivor outside the killed group.
    void drain.catch(() => {});
    return { ok: false, gate, timeoutMs, elapsedMs: Date.now() - started, pid: proc.pid };
  }
  const [stdout = "", stderr = ""] = await drain;
  return { ok: true, code, stdout, stderr };
}
