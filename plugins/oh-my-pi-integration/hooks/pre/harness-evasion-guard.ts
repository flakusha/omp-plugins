// Harness-evasion guard (pre-hook).
//
// Stop-gap for rule `harness-tooling-discipline` part 3: agents may try to
// escape harness tooling via forms interception/rewrite usually misses —
// `command ls`, `builtin cat`, `bash -c "grep ..."`, or full paths like
// `/usr/bin/find`. Bypassing the interception layer defeats the tooling
// guarantees (structure-aware tools, context compression, output routing)
// and the reroute rules (read/grep/glob -> dedicated tools / lean-ctx MCP).
//
// Block with a pointer to the sanctioned path. Tool DISCOVERY via
// `which`/`command -v` is explicitly allowed — the rule mandates discovery;
// only command EXECUTION through evasion forms is blocked.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/** Binaries with dedicated harness tools / interceptors (config.yml bashInterceptor). */
const INTERCEPTED = new Set([
  "ls",
  "cat",
  "grep",
  "rg",
  "ripgrep",
  "find",
  "fd",
  "sed",
  "awk",
  "sort",
  "uniq",
  "head",
  "tail",
  "wc",
  "diff",
  "less",
  "more",
]);

const BIN_ALT = [...INTERCEPTED].join("|");

// `command ls -la` (exec form). `command -v ls` is discovery: the regex
// requires the binary right after `command `, so a `-v` flag breaks the match.
const COMMAND_EXEC = new RegExp(`\\bcommand\\s+(${BIN_ALT})\\b`);
// `builtin cat x`
const BUILTIN_EXEC = new RegExp(`\\bbuiltin\\s+(${BIN_ALT})\\b`);
// `bash -c "grep x"` / `sh -c 'ls -la'` where the inner command starts with
// an intercepted binary (after optional sudo/env prefixes).
const SHELL_C = new RegExp(
  `\\b(?:ba|z|d)?sh\\s+-c\\s+["']?\\s*(?:sudo\\s+|env\\s+\\S+\\s+)*(${BIN_ALT})\\b`,
);
// Full paths: /usr/bin/ls, /bin/cat, /usr/local/bin/grep, /usr/sbin/…
const FULL_PATH = new RegExp(`/(?:usr/)?(?:bin|sbin)/(${BIN_ALT})\\b`);

export const EVASION_REASON =
  "BLOCKED: `command`/`builtin`/`bash -c`/full-path form bypasses harness interception — " +
  "use the dedicated `read`/`grep`/`glob`/`edit` tools (or `mcp__lean_ctx_ctx_*`) instead. " +
  "Tool discovery via `which`/`command -v` stays allowed.";

export function evasionReason(cmd: string): string | undefined {
  if (!cmd || cmd.startsWith("#")) return undefined;
  if (
    COMMAND_EXEC.test(cmd) ||
    BUILTIN_EXEC.test(cmd) ||
    SHELL_C.test(cmd) ||
    FULL_PATH.test(cmd)
  ) {
    return EVASION_REASON;
  }
  return undefined;
}

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    const reason = evasionReason(command);
    if (!reason) return;
    return { block: true, reason };
  });
}
