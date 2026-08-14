import { describe, expect, test } from "bun:test";
import { EVASION_REASON, evasionReason } from "../harness-evasion-guard";

describe("evasionReason", () => {
  test("blocks `command` exec forms", () => {
    expect(evasionReason("command ls -la")).toBe(EVASION_REASON);
    expect(evasionReason("command grep foo")).toBe(EVASION_REASON);
    expect(evasionReason("command cat x")).toBe(EVASION_REASON);
  });

  test("blocks `builtin` forms", () => {
    expect(evasionReason("builtin ls")).toBe(EVASION_REASON);
    expect(evasionReason("builtin wc -l x")).toBe(EVASION_REASON);
  });

  test("blocks `bash -c` wrappers over intercepted binaries", () => {
    expect(evasionReason('bash -c "ls -la"')).toBe(EVASION_REASON);
    expect(evasionReason("sh -c 'grep foo'")).toBe(EVASION_REASON);
    expect(evasionReason('zsh -c "find . -name x"')).toBe(EVASION_REASON);
    expect(evasionReason("bash -c 'sudo rm -rf /tmp/x'")).toBeUndefined(); // rm not intercepted
  });

  test("blocks full-path invocations", () => {
    expect(evasionReason("/usr/bin/ls -la")).toBe(EVASION_REASON);
    expect(evasionReason("/bin/cat /etc/hosts")).toBe(EVASION_REASON);
    expect(evasionReason("/usr/bin/find . -name x")).toBe(EVASION_REASON);
    expect(evasionReason("/usr/local/bin/grep foo")).toBe(EVASION_REASON);
  });

  test("allows discovery and legit forms", () => {
    expect(evasionReason("command -v git")).toBeUndefined();
    expect(evasionReason("which curl")).toBeUndefined();
    expect(evasionReason("git status")).toBeUndefined();
    expect(evasionReason("python3 -c 'print(1)'")).toBeUndefined();
    expect(evasionReason("bun run test")).toBeUndefined();
    expect(evasionReason("curl -s https://example.com")).toBeUndefined();
    expect(evasionReason("")).toBeUndefined();
    expect(evasionReason("# command ls")).toBeUndefined();
  });
});
