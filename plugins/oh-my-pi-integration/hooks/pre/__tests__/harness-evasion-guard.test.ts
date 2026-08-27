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
import {
  EVASION_REASON,
  evasionReason,
  GIT_MUTATING_REASON,
  gitMutatingReason,
  splitCommandSegments,
  stripChainPrefix,
  stripGitOptionPrefix,
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

  test("blocks `git push` on all four evasion forms", () => {
    expect(evasionReason("command git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("builtin git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git push origin main"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("sh -c 'git push --force origin main'")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("/usr/bin/git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("/bin/git push origin main")).toBe(GIT_MUTATING_REASON);
  });

  test("blocks `git stash` pop/apply/drop but allows pathspec-scoped push", () => {
    expect(evasionReason("command git stash")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("builtin git stash pop")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git stash apply"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("/usr/bin/git stash drop")).toBe(GIT_MUTATING_REASON);
    // Pathspec-scoped `git stash push -- <files>` is allowed — won't sweep
    // other agents' in-flight work. Same safe shape as agent/config.yml.
    expect(evasionReason('bash -c "git stash push -- foo.txt"')).toBeUndefined();
    expect(evasionReason("command git stash push --include-untracked -- foo.txt")).toBeUndefined();
  });

  test("blocks chained inner commands on mutating subcommands (existing wrap)", () => {
    expect(evasionReason('bash -c "cd /tmp && git push origin main"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('sh -c "set -e; git reset --hard HEAD~1"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git log && git stash apply"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "echo cleaning && git clean -fd"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git branch -D feat/x"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('bash -c "git commit --amend --no-edit"')).toBe(GIT_MUTATING_REASON);
  });

  // === NEW: unwrapped chained prefix bypass ===========================
  test("blocks unwrapped `cd <repo> && <mutating>` chained prefixes", () => {
    expect(evasionReason("cd /tmp && git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp; git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp || git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp | git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("set -e; git reset --hard HEAD~1")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a; cd /b; git clean -fd")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && cd /b && git branch -D feat/x")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git stash")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git stash apply")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /a && git commit --amend --no-edit")).toBe(GIT_MUTATING_REASON);
  });
  // === NEW: single-ampersand (background) bypass ===================
  // `cd /a & git push` runs `cd /a` in the background and runs `git push`
  // immediately — semantically equivalent to `cd /a; git push` for
  // harness-interception purposes (the second segment executes).
  test("blocks single-`&` (background) chained prefix on mutating subcommands", () => {
    expect(evasionReason("cd /tmp & git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git stash")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp&git push")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git reset --hard HEAD~1")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git clean -fd")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git branch -D feat/x")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & git commit --amend")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("cd /tmp & cat /etc/passwd")).toBe(EVASION_REASON);
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
    expect(evasionReason("cd /tmp && cat /etc/passwd")).toBe(EVASION_REASON);
    expect(evasionReason("cd /tmp && ls -la")).toBe(EVASION_REASON);
    expect(evasionReason("cd /tmp && grep foo x")).toBe(EVASION_REASON);
    expect(evasionReason("cd /tmp; find . -name x")).toBe(EVASION_REASON);
  });

  // === NEW: git -C / -c global-option prefix bypass ===================
  test("blocks `git -C /repo` global-option prefix on mutating subcommands", () => {
    expect(evasionReason("git -C /repo push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp stash")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp reset --hard HEAD~1")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp clean -fd")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp branch -D feat/x")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -C /tmp commit --amend")).toBe(GIT_MUTATING_REASON);
  });

  test("blocks `git -c key=val` global-option prefix on mutating subcommands", () => {
    expect(evasionReason("git -c safe.directory='*' push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -c protocol.version=2 push")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git -c http.sslVerify=false push")).toBe(GIT_MUTATING_REASON);
  });

  test("blocks `--git-dir=` and `--work-tree=` global-option prefixes", () => {
    expect(evasionReason("git --git-dir=/x/.git push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("git --work-tree=/x push")).toBe(GIT_MUTATING_REASON);
  });

  test("combined bypass: chained-prefix + git -C", () => {
    expect(evasionReason("cd /tmp && git -C /repo push origin main")).toBe(GIT_MUTATING_REASON);
    expect(evasionReason("set -e; git -c safe.directory='*' stash apply")).toBe(
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
    expect(evasionReason("command ls -la")).toBe(EVASION_REASON);
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
    expect(evasionReason(`lean-ctx -c "${inner}"`)).toBe(EVASION_REASON);
  });

  test('blocks bare-intercepted-binary in inner payload (rtk -c "tail -60 ...")', () => {
    // Bare-tail is NOT an evasion by itself (bashInterceptor's job, not the
    // guard's), but inside a shell-string wrapper it IS — the wrapper
    // replaces bash, so bashInterceptor never sees the tail at all.
    expect(evasionReason('rtk -c "tail -60 foo.log"')).toBe(EVASION_REASON);
    expect(evasionReason('rtk -c "ls /tmp"')).toBe(EVASION_REASON);
    expect(evasionReason('rtk -c "cat /etc/passwd"')).toBe(EVASION_REASON);
  });

  test('blocks git-mutating in inner payload (xd -c "git push ...")', () => {
    // Bare `git push` is bashInterceptor's job. Inside a wrapper, the inner
    // string is what gets executed and bashInterceptor never sees it.
    expect(evasionReason('xd -c "git push origin main"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('lean-ctx -c "git push origin main"')).toBe(GIT_MUTATING_REASON);
    expect(evasionReason('rtk -c "git stash"')).toBe(GIT_MUTATING_REASON);
  });

  test("blocks --command and -e flag variants", () => {
    expect(evasionReason('bash --command "cat /etc/passwd"')).toBe(EVASION_REASON);
    expect(evasionReason('bash --command="cat /etc/passwd"')).toBe(EVASION_REASON);
    expect(evasionReason('bash -e "cat /etc/passwd"')).toBe(EVASION_REASON);
  });

  test("blocks chained-prefix + wrapper-prefix combinations", () => {
    // `cd /repo && env cat …` — chain-prefix hides the wrapper+INTERCEPTED
    // from bashInterceptor's `^\s*<bin>` anchor. After stripChainPrefix +
    // stripWrapperPrefix, the deChained segment starts with an INTERCEPTED
    // binary and the guard fires.
    expect(evasionReason("cd /repo && env cat /etc/passwd")).toBe(EVASION_REASON);
    expect(evasionReason("cd /repo && sudo cat /etc/passwd")).toBe(EVASION_REASON);
    expect(evasionReason("cd /repo && nohup cat /etc/passwd")).toBe(EVASION_REASON);
    expect(evasionReason("cd /repo && env ls /etc")).toBe(EVASION_REASON);
    expect(evasionReason("cd /repo && sudo -u root cat /etc/passwd")).toBe(EVASION_REASON);
    expect(evasionReason("cd /repo && env VAR=val grep x")).toBe(EVASION_REASON);
    // Multi-segment chains.
    expect(evasionReason("cd /a && cd /b && env cat /etc/passwd")).toBe(EVASION_REASON);
    expect(evasionReason("cd /a; env grep x")).toBe(EVASION_REASON);
    expect(evasionReason("cd /a || env head file")).toBe(EVASION_REASON);
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

  test("does NOT recurse into general-purpose scripting hosts", () => {
    // `node -e` and `python -c` are NOT in SHELL_PASSTHROUGH — their
    // string-literal contents frequently reference intercepted-token names
    // (`node -e "require('cat')"`) without actually executing them. Keeping
    // these out of the recursion prevents false-positive blocks on legit
    expect(evasionReason('node -e "con' + 'sole.log(\\"cat\\")"')).toBeUndefined();
    expect(evasionReason(String.raw`python -c "print('cat')"`)).toBeUndefined();
    expect(evasionReason(String.raw`ruby -e "puts 'cat'"`)).toBeUndefined();
  });

  test("does NOT confuse `git -c protocol.version=2 ...` with `-c` wrapper", () => {
    // `git -c key=val` is a git global-option, NOT a shell-passthrough `-c`.
    // The bare-grep regex inside SHELL_STRING_FLAG anchors on `[\s,;&|]+`
    // before the flag — `git -c protocol.version=2 push` has `git` (not in
    // SHELL_PASSTHROUGH) followed by `-c`, but the inner payload
    // `protocol.version=2` is not in quotes, so group 3/4/5 don't fire.
    expect(evasionReason("git -c protocol.version=2 push origin main")).toBe(GIT_MUTATING_REASON);
  });
});
