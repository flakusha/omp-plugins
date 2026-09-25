// Test cases for the harness-evasion guard (pre-hook).
//
// Coverage matrix:
//   - command/builtin/bash -c/full-path wrappers over INTERCEPTED binaries
//     (ls/cat/grep/find/etc.) are blocked.
//   - `git push`/`git stash`/`git reset --hard`/`git clean -fd`/
//     `git branch -D`/`git commit --amend` on all four evasion forms are
//     blocked; read-only git stays allowed.
//   - Pathspec-scoped `git stash push -- <files>` is allowed.
//   - CHAINED PREFIXES: `cd /repo && git push …`, `set -e; git push`,
//     `cd a || git reset --hard` are blocked (the existing `bash -c "cd &&"`
//     guard still passes — this closes the unwrapped-shell gap).
//   - `git` GLOBAL-OPTION PREFIXES: `git -C /repo push …`,
//     `git -c safe.directory='*' push …`, `git --git-dir=/x/.git stash`,
//     `git --work-tree=/x push …` are blocked even though `git <subcmd>`
//     adjacency is broken by the option.

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bashWriteReason,
  CHAIN_REASON,
  EVASION_REASON,
  evasionReason,
  GIT_MUTATING_REASON,
  gitMutatingReason,
  INTERPRETER_INLINE_REASON,
  interpreterInlineReason,
  splitCommandSegments,
  stripChainPrefix,
  stripGitOptionPrefix,
  WRITE_TARGET_REASON,
} from "../harness-evasion-guard";

describe("splitCommandSegments", () => {
  test("returns the input as one segment when no separators exist", () => {
    expect(splitCommandSegments("git status")).toEqual(["git status"]);
    expect(splitCommandSegments("ls -la")).toEqual(["ls -la"]);
  });

  test("splits on &&, ||, ;, |, and \\n", () => {
    expect(splitCommandSegments("cd /a && git status")).toEqual(["cd /a", "git status"]);
    expect(splitCommandSegments("cd /a ; git status")).toEqual(["cd /a", "git status"]);
    expect(splitCommandSegments("cd /a || git status")).toEqual(["cd /a", "git status"]);
    expect(splitCommandSegments("cd /a | git status")).toEqual(["cd /a", "git status"]);
    expect(splitCommandSegments("cd /a\n  git status")).toEqual(["cd /a", "git status"]);
  });

  test("respects single- and double-quoted regions", () => {
    expect(splitCommandSegments("echo 'a && b' && git push")).toEqual([
      "echo 'a && b'",
      "git push",
    ]);
    expect(splitCommandSegments(`echo "a; b" && git push`)).toEqual([`echo "a; b"`, "git push"]);
    expect(splitCommandSegments("cmd \"arg='val'\" && cat x")).toEqual([
      `cmd "arg='val'"`,
      "cat x",
    ]);
  });

  test("returns empty for empty input", () => {
    expect(splitCommandSegments("")).toEqual([]);
  });

  test("handles repeated separators without emitting empty segments", () => {
    expect(splitCommandSegments("git status && && git push")).toEqual(["git status", "git push"]);
  });
});

describe("stripChainPrefix", () => {
  test("strips `cd <path> && …`", () => {
    expect(stripChainPrefix("cd /tmp && git status")).toBe("git status");
    expect(stripChainPrefix("cd /tmp; git status")).toBe("git status");
    expect(stripChainPrefix("cd /tmp\n  git status")).toBe("git status");
  });

  test("strips `cd` with quoted paths", () => {
    expect(stripChainPrefix('cd "/tmp/with space" && git push')).toBe("git push");
    expect(stripChainPrefix("cd '/tmp/x' ; ls")).toBe("ls");
  });

  test("strips `cd -` (returns to $OLDPWD)", () => {
    expect(stripChainPrefix("cd - && git push")).toBe("git push");
  });

  test("strips chained repeats (cd a; cd b; cmd)", () => {
    expect(stripChainPrefix("cd /a; cd /b; git push")).toBe("git push");
  });

  test("strips `pushd`", () => {
    expect(stripChainPrefix("pushd /tmp && git stash")).toBe("git stash");
  });

  test("strips `set -e`/`set +o pipefail` style shell-option prefixes", () => {
    expect(stripChainPrefix("set -e && git push")).toBe("git push");
    expect(stripChainPrefix("set +o pipefail ; git stash")).toBe("git stash");
    expect(stripChainPrefix("set -eu -o pipefail; git reset --hard")).toBe("git reset --hard");
  });

  test("strips `:`, `true`, `false` no-op fillers", () => {
    expect(stripChainPrefix(": && git status")).toBe("git status");
    expect(stripChainPrefix("true; git status")).toBe("git status");
    expect(stripChainPrefix("false ; git status")).toBe("git status");
  });

  test("leaves non-chain prefixes untouched", () => {
    expect(stripChainPrefix("git status")).toBe("git status");
    expect(stripChainPrefix("cd /tmp && not-a-cmd")).toBe("not-a-cmd");
  });
});
describe("stripGitOptionPrefix", () => {
  test("strips `-C <path>`", () => {
    expect(stripGitOptionPrefix("git -C /repo push origin main")).toBe("git  push origin main");
    expect(stripGitOptionPrefix("git -C /repo stash")).toBe("git  stash");
  });

  test("strips `-c <key>=<value>`", () => {
    expect(stripGitOptionPrefix("git -c protocol.version=2 push")).toBe("git  push");
    expect(stripGitOptionPrefix("git -c safe.directory='*' fetch")).toBe("git  fetch");
  });

  test("strips `--git-dir=<p>` and `--work-tree=<p>`", () => {
    expect(stripGitOptionPrefix("git --git-dir=/x/.git push")).toBe("git  push");
    expect(stripGitOptionPrefix("git --work-tree=/x status")).toBe("git  status");
  });

  test("strips standalone flags `--bare`, `-P`, `--no-pager`", () => {
    expect(stripGitOptionPrefix("git --bare push")).toBe("git  push");
    expect(stripGitOptionPrefix("git -P log --oneline")).toBe("git  log --oneline");
    expect(stripGitOptionPrefix("git --no-pager diff")).toBe("git  diff");
  });

  test("leaves read-only git untouched in substance", () => {
    expect(stripGitOptionPrefix("git status")).toBe("git status");
    expect(stripGitOptionPrefix("git log -1")).toBe("git log -1");
  });
});

describe("evasionReason", () => {
  test("blocks `command` exec forms", () => {
    expect(evasionReason("command ls -la")).toContain(EVASION_REASON);
    expect(evasionReason("command grep foo")).toContain(EVASION_REASON);
    expect(evasionReason("command cat x")).toContain(EVASION_REASON);
  });

  test("blocks `builtin` forms", () => {
    expect(evasionReason("builtin ls")).toContain(EVASION_REASON);
    expect(evasionReason("builtin wc -l x")).toContain(EVASION_REASON);
  });

  test("blocks `bash -c` wrappers over intercepted binaries", () => {
    expect(evasionReason('bash -c "ls -la"')).toContain(EVASION_REASON);
    expect(evasionReason("sh -c 'grep foo'")).toContain(EVASION_REASON);
    expect(evasionReason('zsh -c "find . -name x"')).toContain(EVASION_REASON);
    expect(evasionReason("bash -c 'sudo rm -rf /tmp/x'")).toBeUndefined(); // rm not intercepted
  });

  test("blocks full-path invocations", () => {
    expect(evasionReason("/usr/bin/ls -la")).toContain(EVASION_REASON);
    expect(evasionReason("/bin/cat /etc/hosts")).toContain(EVASION_REASON);
    expect(evasionReason("/usr/bin/find . -name x")).toContain(EVASION_REASON);
    expect(evasionReason("/usr/local/bin/grep foo")).toContain(EVASION_REASON);
  });

  test("allows discovery and legit forms", () => {
    expect(evasionReason("command -v git")).toBeUndefined();
    expect(evasionReason("which curl")).toBeUndefined();
    expect(evasionReason("git status")).toBeUndefined();
    expect(evasionReason("python3 -c 'print(1)'")).toContain(INTERPRETER_INLINE_REASON);
    expect(evasionReason("bun run test")).toBeUndefined();
    expect(evasionReason("curl -s https://example.com")).toBeUndefined();
    expect(evasionReason("")).toBeUndefined();
    expect(evasionReason("# command ls")).toBeUndefined();
  });

  test("blocks `git push` on all four evasion forms", () => {
    expect(evasionReason("command git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("builtin git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git push origin main"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("sh -c 'git push --force origin main'")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("/usr/bin/git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("/bin/git push origin main")).toContain(GIT_MUTATING_REASON);
  });

  test("blocks `git stash` pop/apply/drop but allows pathspec-scoped push", () => {
    expect(evasionReason("command git stash")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("builtin git stash pop")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git stash apply"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("/usr/bin/git stash drop")).toContain(GIT_MUTATING_REASON);
    // Pathspec-scoped `git stash push -- <files>` is allowed — won't sweep
    // other agents' in-flight work. Same safe shape as agent/config.yml.
    expect(evasionReason('bash -c "git stash push -- foo.txt"')).toBeUndefined();
    expect(evasionReason("command git stash push --include-untracked -- foo.txt")).toBeUndefined();
    // Read-only stash inspection is allowed on every reach (config mirrors).
    expect(evasionReason("cd /a && git stash list")).toBeUndefined();
    expect(evasionReason('bash -c "git stash list"')).toBeUndefined();
    expect(evasionReason("git -C /a stash show")).toBeUndefined();
    expect(evasionReason("command git stash list")).toBeUndefined();
    // pop/apply/drop still blocked on disguise reaches.
    expect(evasionReason("cd /a && git stash pop")).toContain(GIT_MUTATING_REASON);
  });

  test("allows `git branch -d` (safe merged-only delete) on all reaches", () => {
    expect(evasionReason("cd /a && git branch -d feat/x")).toBeUndefined();
    expect(evasionReason('bash -c "git branch -d feat/x"')).toBeUndefined();
    expect(evasionReason("command git branch -d feat/x")).toBeUndefined();
    expect(evasionReason("git -C /a branch -d feat/x")).toBeUndefined();
    expect(evasionReason("cd /a && git branch -d a b c")).toBeUndefined();
  });

  test("blocks force branch deletes on disguise reaches", () => {
    expect(evasionReason("cd /a && git branch -D feat/x")).toContain("branch -D");
    expect(evasionReason("git -C /a branch -D feat/x")).toContain("branch -D");
    expect(evasionReason('bash -c "git branch -D feat/x"')).toContain("branch -D");
    expect(evasionReason("cd /a && git branch -df feat/x")).toContain("branch -df");
    expect(evasionReason("cd /a && git branch -fd feat/x")).toContain("branch -fd");
    expect(evasionReason("cd /a && git branch -d -f feat/x")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git branch -d --force feat/x")).toContain(GIT_MUTATING_REASON);
    // force-delete fix line points at the safe shape.
    expect(evasionReason("cd /a && git branch -D feat/x")).toContain("branch -d <branch>");
  });

  test("blocks chained inner commands on mutating subcommands (existing wrap)", () => {
    expect(evasionReason('bash -c "cd /tmp && git push origin main"')).toContain(
      GIT_MUTATING_REASON,
    );
    expect(evasionReason('sh -c "set -e; git reset --hard HEAD~1"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git log && git stash apply"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "echo cleaning && git clean -fd"')).toContain(
      GIT_MUTATING_REASON,
    );
    expect(evasionReason('bash -c "git branch -D feat/x"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git commit --amend --no-edit"')).toContain(GIT_MUTATING_REASON);
  });

  // === NEW: unwrapped chained prefix bypass ===========================
  test("blocks unwrapped `cd <repo> && <mutating>` chained prefixes", () => {
    expect(evasionReason("cd /tmp && git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp; git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp || git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp | git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("set -e; git reset --hard HEAD~1")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a; cd /b; git clean -fd")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && cd /b && git branch -D feat/x")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git stash")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git stash apply")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git commit --amend --no-edit")).toContain(GIT_MUTATING_REASON);
  });
  // === NEW: single-ampersand (background) bypass ===================
  // `cd /a & git push` runs `cd /a` in the background and runs `git push`
  // immediately — semantically equivalent to `cd /a; git push` for
  // harness-interception purposes (the second segment executes).
  test("blocks single-`&` (background) chained prefix on mutating subcommands", () => {
    expect(evasionReason("cd /tmp & git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git stash")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp&git push")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git reset --hard HEAD~1")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git clean -fd")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git branch -D feat/x")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git commit --amend")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & cat /etc/passwd")).toContain(CHAIN_REASON);
  });
  // === NEW: backslash-escape stays in same segment ================
  // Regression: backslash-escaped shell metacharacters must NOT be
  // treated as segment separators. `echo a\&b` is one shell command;
  // `echo \&\& git push` does NOT contain a real `&&` separator.
  test("backslash escape keeps escaped chars in same segment", () => {
    expect(splitCommandSegments("echo \\&\\& git push")).toEqual(["echo \\&\\& git push"]);
    expect(splitCommandSegments("echo a\\ b && git push")).toEqual(["echo a\\ b", "git push"]);
    expect(splitCommandSegments("echo \\&git push")).toEqual(["echo \\&git push"]);
  });
  test("blocks `cd <repo> && <interception-binary>` non-git evasions", () => {
    expect(evasionReason("cd /tmp && cat /etc/passwd")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /tmp && ls -la")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /tmp && grep foo x")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /tmp; find . -name x")).toContain(CHAIN_REASON);
  });

  // === NEW: git -C / -c global-option prefix bypass ===================
  test("blocks `git -C /repo` global-option prefix on mutating subcommands", () => {
    expect(evasionReason("git -C /repo push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp stash")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp reset --hard HEAD~1")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp clean -fd")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp branch -D feat/x")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp commit --amend")).toContain(GIT_MUTATING_REASON);
  });

  test("blocks `git -c key=val` global-option prefix on mutating subcommands", () => {
    expect(evasionReason("git -c safe.directory='*' push origin main")).toContain(
      GIT_MUTATING_REASON,
    );
    expect(evasionReason("git -c protocol.version=2 push")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git -c http.sslVerify=false push")).toContain(GIT_MUTATING_REASON);
  });

  test("blocks `--git-dir=` and `--work-tree=` global-option prefixes", () => {
    expect(evasionReason("git --git-dir=/x/.git push origin main")).toContain(GIT_MUTATING_REASON);
    expect(evasionReason("git --work-tree=/x push")).toContain(GIT_MUTATING_REASON);
  });

  test("combined bypass: chained-prefix + git -C", () => {
    expect(evasionReason("cd /tmp && git -C /repo push origin main")).toContain(
      GIT_MUTATING_REASON,
    );
    expect(evasionReason("set -e; git -c safe.directory='*' stash apply")).toContain(
      GIT_MUTATING_REASON,
    );
  });

  test("does NOT block read-only git subcommands (with or without options)", () => {
    expect(evasionReason("git status")).toBeUndefined();
    expect(evasionReason("git log --oneline -5")).toBeUndefined();
    expect(evasionReason("git diff HEAD~1")).toBeUndefined();
    expect(evasionReason("git show HEAD")).toBeUndefined();
    expect(evasionReason("git stash list")).toBeUndefined();
    expect(evasionReason("command git status")).toBeUndefined();
    expect(evasionReason("builtin git log -1")).toBeUndefined();
    expect(evasionReason('bash -c "git status"')).toBeUndefined();
    expect(evasionReason('bash -c "git log --oneline -5"')).toBeUndefined();
    expect(evasionReason("/usr/bin/git status")).toBeUndefined();
    // global-option prefixes on read-only commands: still allowed.
    expect(evasionReason("git -C /repo status")).toBeUndefined();
    expect(evasionReason("git -C /repo log --oneline -5")).toBeUndefined();
    expect(evasionReason("git --git-dir=/x/.git log -1")).toBeUndefined();
    // chained-prefix with read-only git: still allowed.
    expect(evasionReason("cd /tmp && git status")).toBeUndefined();
    expect(evasionReason("cd /tmp && git log --oneline -5")).toBeUndefined();
  });

  test("does NOT block pathspec-scoped stash push via bypass forms", () => {
    expect(evasionReason("cd /a && git stash push -- foo.txt")).toBeUndefined();
    expect(evasionReason("git -C /a stash push -- foo.txt")).toBeUndefined();
    expect(evasionReason('bash -c "cd /a && git stash push -- foo.txt"')).toBeUndefined();
  });

  test("gitMutatingReason returns undefined for read-only git and shell-only commands", () => {
    expect(gitMutatingReason("")).toBeUndefined();
    expect(gitMutatingReason("# git push origin main")).toBeUndefined();
    expect(gitMutatingReason("git push origin main")).toBeUndefined();
    expect(gitMutatingReason("command -v git")).toBeUndefined();
  });

  test("gitMutatingReason is preferred over EVASION_REASON for git-shaped evasions", () => {
    // `command ls` should still return EVASION_REASON (the original 17-binary
    // INTERCEPTED behavior is unchanged). Sanity check the wiring order.
    expect(evasionReason("command ls -la")).toContain(EVASION_REASON);
  });

  // === NEW: shell-string flag wrapper (`-c "<inner>"`) ================
  // `lean-ctx -c "..."` / `rtk -c "..."` / `xd -c "..."` / `bash -c "..."` /
  // `--command "..."` / `-e "..."` — these wrappers replace bash and so
  // bashInterceptor never sees the inner command. The harness recurses into
  // the inner payload via SHELL_STRING_FLAG and blocks if the inner itself
  // would be a violation.

  test('blocks `lean-ctx -c "<chained-prefix-tal>"` (user-reported bypass)', () => {
    // The exact shape from the user report: `cd /repo && ... | tail -60`.
    // The inner `tail -60` is hidden behind a chained prefix from
    // bashInterceptor's `^\s*tail` anchor; recursion flags it.
    const inner =
      "cd /home/flak/git-ai/loop-lore/tree/feat-middleware-request-lifecycle && timeout 240 bun run scripts/worktree/finalize feat-middleware-request-lifecycle 2>&1 | tail -60";
    // The inner payload is evaluated recursively; the piped `tail -60` is
    // reported as a chain-segment reach (behind `|`) with a tool fix, but the
    // outer wrapper is still blocked — bashInterceptor never sees the inner.
    expect(evasionReason(`lean-ctx -c "${inner}"`)).toContain(CHAIN_REASON);
    expect(evasionReason(`lean-ctx -c "${inner}"`)).toContain("matched: `tail`");
  });

  test('blocks bare-intercepted-binary in inner payload (rtk -c "tail -60 ...")', () => {
    // Bare-tail is NOT an evasion by itself (bashInterceptor's job, not the
    // guard's), but inside a shell-string wrapper it IS — the wrapper
    // replaces bash, so bashInterceptor never sees the tail at all.
    expect(evasionReason('rtk -c "tail -60 foo.log"')).toContain(EVASION_REASON);
    expect(evasionReason('rtk -c "ls /tmp"')).toContain(EVASION_REASON);
    expect(evasionReason('rtk -c "cat /etc/passwd"')).toContain(EVASION_REASON);
  });

  test('blocks git-mutating in inner payload (xd -c "git push ...")', () => {
    // Bare `git push` is bashInterceptor's job. Inside a wrapper, the inner
    // string is what gets executed and bashInterceptor never sees it.
    expect(evasionReason('xd -c "git push origin main"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('lean-ctx -c "git push origin main"')).toContain(GIT_MUTATING_REASON);
    expect(evasionReason('rtk -c "git stash"')).toContain(GIT_MUTATING_REASON);
  });

  test("blocks --command and -e flag variants", () => {
    expect(evasionReason('bash --command "cat /etc/passwd"')).toContain(EVASION_REASON);
    expect(evasionReason('bash --command="cat /etc/passwd"')).toContain(EVASION_REASON);
    expect(evasionReason('bash -e "cat /etc/passwd"')).toContain(EVASION_REASON);
  });

  test("blocks chained-prefix + wrapper-prefix combinations", () => {
    // `cd /repo && env cat …` — chain-prefix hides the wrapper+INTERCEPTED
    // from bashInterceptor's `^\s*<bin>` anchor. After stripChainPrefix +
    // stripWrapperPrefix, the deChained segment starts with an INTERCEPTED
    // binary and the guard fires.
    expect(evasionReason("cd /repo && env cat /etc/passwd")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /repo && sudo cat /etc/passwd")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /repo && nohup cat /etc/passwd")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /repo && env ls /etc")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /repo && sudo -u root cat /etc/passwd")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /repo && env VAR=val grep x")).toContain(CHAIN_REASON);
    // Multi-segment chains.
    expect(evasionReason("cd /a && cd /b && env cat /etc/passwd")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /a; env grep x")).toContain(CHAIN_REASON);
    expect(evasionReason("cd /a || env head file")).toContain(CHAIN_REASON);
  });

  test("allows wrapper-prefix chains that don't reach an INTERCEPTED binary", () => {
    // `env VAR=val /etc/passwd` is benign — no INTERCEPTED binary invoked.
    expect(evasionReason("env VAR=val /etc/passwd")).toBeUndefined();
    expect(evasionReason("env -- /etc/passwd")).toBeUndefined();
    expect(evasionReason("sudo -- ls /root")).toBeUndefined();
  });

  test("allows benign inner payloads through shell-string wrappers", () => {
    // No intercepted binary or git-mutating subcommand inside → not a violation.
    expect(evasionReason('lean-ctx -c "echo hello"')).toBeUndefined();
    expect(evasionReason('rtk -c "echo world"')).toBeUndefined();
    expect(evasionReason('xd -c "echo hello"')).toBeUndefined();
  });

  test("general-purpose scripting hosts: no INTERCEPTED-token recursion, but inline code is gated", () => {
    // `node -e` and `python -c` are NOT in SHELL_PASSTHROUGH — their
    // string-literal contents are not scanned for intercepted-token names
    // (`node -e "require('cat')"`). But the invocation itself is inline
    // interpreter code, gated by the eval policy since eval.py/eval.js are
    // disabled (INTERPRETER_INLINE_REASON supersedes the old allow).
    expect(evasionReason('node -e "con' + 'sole.log(\\"cat\\")"')).toContain(
      INTERPRETER_INLINE_REASON,
    );
    expect(evasionReason(String.raw`python -c "print('cat')"`)).toContain(
      INTERPRETER_INLINE_REASON,
    );
    expect(evasionReason(String.raw`ruby -e "puts 'cat'"`)).toContain(INTERPRETER_INLINE_REASON);
  });

  test("does NOT confuse `git -c protocol.version=2 ...` with `-c` wrapper", () => {
    // `git -c key=val` is a git global-option, NOT a shell-passthrough `-c`.
    // The bare-grep regex inside SHELL_STRING_FLAG anchors on `[\s,;&|]+`
    // before the flag — `git -c protocol.version=2 push` has `git` (not in
    // SHELL_PASSTHROUGH) followed by `-c`, but the inner payload
    // `protocol.version=2` is not in quotes, so group 3/4/5 don't fire.
    expect(evasionReason("git -c protocol.version=2 push origin main")).toContain(
      GIT_MUTATING_REASON,
    );
  });
});

describe("bashWriteReason", () => {
  const OUTSIDE = join(tmpdir(), "esc.txt");

  test("blocks redirection targets outside the project root", () => {
    expect(bashWriteReason(`echo hi > ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason(`echo hi >> ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason(`echo hi 2> ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason(`echo hi &> ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason("echo hi > ~/esc.txt")).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason(`cd /tmp && echo x > ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
  });

  test("blocks tee file arguments outside the project root", () => {
    expect(bashWriteReason(`sort f | tee ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason(`sort f | tee -a ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
    expect(bashWriteReason("sudo tee /etc/hostname")).toContain(WRITE_TARGET_REASON);
    // wrapper payloads are caught by evasionReason's inner-payload recursion,
    // not by the per-segment bashWriteReason scan
    expect(evasionReason(`lean-ctx -c "echo x > ${OUTSIDE}"`)).toContain(WRITE_TARGET_REASON);
  });

  test("allows in-root, /dev-sink, and fd-dup targets", () => {
    expect(bashWriteReason("echo x > .tmp/out.txt")).toBeUndefined();
    expect(bashWriteReason("echo x > out.txt")).toBeUndefined();
    expect(bashWriteReason("echo x >> ./.tmp/log")).toBeUndefined();
    expect(bashWriteReason("bun test > /dev/null 2>&1")).toBeUndefined();
    expect(bashWriteReason("sort f | tee out.txt")).toBeUndefined();
    expect(bashWriteReason("sort f | tee")).toBeUndefined();
    expect(
      bashWriteReason(`sort f | tee -a ${join(process.cwd(), ".tmp", "log")}`),
    ).toBeUndefined();
  });

  test("ignores quoted redirection characters", () => {
    expect(bashWriteReason('echo "a > b" > in-root.txt')).toBeUndefined();
    expect(bashWriteReason(`echo "a > b" > ${OUTSIDE}`)).toContain(WRITE_TARGET_REASON);
  });

  test("does not regress existing evasion verdicts", () => {
    expect(evasionReason("bun test > /dev/null")).toBeUndefined();
    expect(evasionReason(`lean-ctx -c "echo x > ${OUTSIDE}"`)).toContain(WRITE_TARGET_REASON);
  });
});

describe("interpreterInlineReason", () => {
  test("blocks flag-based inline code across interpreters", () => {
    expect(interpreterInlineReason(`python -c "print(1)"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`python3 -c "print(1)"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`env python -c "x"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`sudo python3 -c "x"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`timeout 10 python -c "x"`)).toContain(
      INTERPRETER_INLINE_REASON,
    );
    expect(interpreterInlineReason(`node -e "require('x')"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`node --eval "x"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`node -p "1+1"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`bun -e "x"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`bun --print "process.version"`)).toContain(
      INTERPRETER_INLINE_REASON,
    );
    expect(interpreterInlineReason(`tsx -e "x"`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`deno eval "console.log(1)"`)).toContain(
      INTERPRETER_INLINE_REASON,
    );
    expect(interpreterInlineReason(`perl -e 'print 1;'`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`perl -pe 's/a/b/' f.txt`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`perl -ne 'print;' f.txt`)).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason(`ruby -e 'puts 1'`)).toContain(INTERPRETER_INLINE_REASON);
    // python value flags (-W/-X) do not hide a following -c
    expect(interpreterInlineReason(`python -X utf8 -c "x"`)).toContain(INTERPRETER_INLINE_REASON);
  });

  test("blocks stdin and heredoc program shapes", () => {
    expect(interpreterInlineReason("python - <<EOF")).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason("python - <<'EOF'")).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason("python <<EOF")).toContain(INTERPRETER_INLINE_REASON);
    expect(interpreterInlineReason("node - <<'EOF'")).toContain(INTERPRETER_INLINE_REASON);
    // piped bare interpreter = stdin program
    expect(interpreterInlineReason("echo 'print(1)' | python")).toContain(
      INTERPRETER_INLINE_REASON,
    );
    expect(interpreterInlineReason("echo x | python3")).toContain(INTERPRETER_INLINE_REASON);
    // chained prefixes cannot hide it
    expect(interpreterInlineReason(`cd /tmp && python -c "x"`)).toContain(
      INTERPRETER_INLINE_REASON,
    );
    // bash -c inner payload recursion
    expect(evasionReason(`bash -c "python -c 'print(1)'"`)).toContain(INTERPRETER_INLINE_REASON);
  });

  test("allows file-based runs and non-interpreter flag users", () => {
    expect(interpreterInlineReason("python .tmp/x.py")).toBeUndefined();
    expect(interpreterInlineReason("python3 .tmp/x.py --flag")).toBeUndefined();
    expect(interpreterInlineReason("python -m venv .venv")).toBeUndefined();
    expect(interpreterInlineReason("python -m pytest .tmp/")).toBeUndefined();
    expect(interpreterInlineReason("python -u .tmp/x.py")).toBeUndefined();
    expect(interpreterInlineReason("node server.js")).toBeUndefined();
    expect(interpreterInlineReason("node --watch .tmp/x.ts")).toBeUndefined();
    expect(interpreterInlineReason("bun run dev")).toBeUndefined();
    expect(interpreterInlineReason("bun .tmp/x.ts")).toBeUndefined();
    expect(interpreterInlineReason("deno run -A .tmp/x.ts")).toBeUndefined();
    expect(interpreterInlineReason("perl script.pl")).toBeUndefined();
    // perl -p is a loop flag, not inline code
    expect(interpreterInlineReason("perl -p in.txt")).toBeUndefined();
    expect(interpreterInlineReason("ruby script.rb")).toBeUndefined();
    // non-interpreter heads keep their own semantics
    expect(interpreterInlineReason("grep -c foo file.txt")).toBeUndefined();
    expect(interpreterInlineReason("git -c protocol.version=2 push")).toBeUndefined();
    // a mention inside an echo argument is not an invocation
    expect(interpreterInlineReason(`echo "python -c x"`)).toBeUndefined();
    expect(evasionReason("python .tmp/x.py")).toBeUndefined();
  });
});

// Evidence contract: every block reason must answer WHAT matched, WHERE, and
// HOW to replace the command — otherwise the model cannot self-correct.
describe("block reason evidence contract", () => {
  test("chain-reach reasons name the binary, segment, and tool fix", () => {
    const reason = evasionReason("cd /repo && tail -30 build.log");
    expect(reason).toContain(CHAIN_REASON);
    expect(reason).toContain("matched: `tail`");
    expect(reason).toContain("tail -30 build.log");
    expect(reason).toContain("fix: `read` tool");
    expect(reason).toContain(":-N");
  });

  test("wrapper reasons name the wrapper form and dedicated tool", () => {
    const reason = evasionReason("command grep foo bar.md");
    expect(reason).toContain(EVASION_REASON);
    expect(reason).toContain("matched: `grep`");
    expect(reason).toContain("drop the `command` prefix");
    expect(reason).toContain("`grep` tool");
  });

  test("git-mutating reasons name the subcommand and per-sub fix", () => {
    const push = evasionReason("cd /repo && git push origin main");
    expect(push).toContain("matched: `git push`");
    expect(push).toContain("(ask)");
    const stash = evasionReason("git -C /repo stash");
    expect(stash).toContain("matched: `git stash`");
    expect(stash).toContain("git stash push -- <pathspec-you-own>");
  });

  test("write-target reasons echo the offending path", () => {
    const reason = bashWriteReason("echo x > /etc/hostname");
    expect(reason).toContain("/etc/hostname");
    expect(reason).toContain(".tmp/");
  });

  test("interpreter-inline reasons echo the segment and .tmp fix", () => {
    const reason = interpreterInlineReason(`cd /tmp && python -c "x"`);
    expect(reason).toContain("python -c");
    expect(reason).toContain(".tmp/x.py");
  });

  test("evidence spans are bounded", () => {
    const long = "x".repeat(300);
    const reason = evasionReason(`cd /repo && cat ${long}.txt`);
    expect(reason?.length ?? 0).toBeLessThan(700);
  });
});
