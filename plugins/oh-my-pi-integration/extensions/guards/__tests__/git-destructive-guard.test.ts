import { describe, expect, test } from "bun:test";
import { GIT_DESTRUCTIVE_NOTICE, isDestructiveGitCommand } from "../git-destructive-guard";

describe("isDestructiveGitCommand", () => {
  test("flags work-destroying git commands", () => {
    expect(isDestructiveGitCommand("git stash")).toBe(true);
    expect(isDestructiveGitCommand("git stash -m wip")).toBe(true);
    expect(isDestructiveGitCommand("git stash drop")).toBe(true);
    expect(isDestructiveGitCommand("git reset --hard")).toBe(true);
    expect(isDestructiveGitCommand("git reset --hard HEAD~2")).toBe(true);
    expect(isDestructiveGitCommand("git clean -fd")).toBe(true);
    expect(isDestructiveGitCommand("git checkout -f")).toBe(true);
    expect(isDestructiveGitCommand("git checkout -- src/x.ts")).toBe(true);
    expect(isDestructiveGitCommand("git push --force")).toBe(true);
    expect(isDestructiveGitCommand("git push -f origin main")).toBe(true);
    expect(isDestructiveGitCommand("git branch -D old-branch")).toBe(true);
    expect(isDestructiveGitCommand("git -C /tmp/x stash")).toBe(true);
  });

  test("allows safe or unrelated git", () => {
    expect(isDestructiveGitCommand("git stash pop")).toBe(false);
    expect(isDestructiveGitCommand("git stash apply")).toBe(false);
    expect(isDestructiveGitCommand("git reset --soft HEAD~1")).toBe(false);
    expect(isDestructiveGitCommand("git checkout main")).toBe(false);
    expect(isDestructiveGitCommand("git checkout --track origin/x")).toBe(false);
    expect(isDestructiveGitCommand("git branch -d merged")).toBe(false);
    expect(isDestructiveGitCommand("git status")).toBe(false);
    expect(isDestructiveGitCommand("git push origin main")).toBe(false);
    expect(isDestructiveGitCommand("")).toBe(false);
  });
});

describe("GIT_DESTRUCTIVE_NOTICE", () => {
  test("names the risk and the restore action", () => {
    expect(GIT_DESTRUCTIVE_NOTICE).toContain("GIT-DESTRUCTIVE");
    expect(GIT_DESTRUCTIVE_NOTICE).toContain("ask the user");
  });
});
