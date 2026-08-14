import { describe, expect, test } from "bun:test";
import {
  isSshSockFailure,
  isSshTamperCommand,
  SSH_BLOCK_REASON,
  sshSockHardStop,
} from "../ssh-guard";

describe("isSshSockFailure", () => {
  test("matches missing/stale agent or socket markers", () => {
    expect(isSshSockFailure("Could not open a connection to your authentication agent.")).toBe(
      true,
    );
    expect(isSshSockFailure("error connecting to agent: No such file or directory")).toBe(true);
    expect(isSshSockFailure("authentication agent has no keys")).toBe(true);
  });

  test("does not match ordinary auth/network failures (agent can investigate)", () => {
    expect(isSshSockFailure("Permission denied (publickey)")).toBe(false);
    expect(isSshSockFailure("Connection refused")).toBe(false);
    expect(isSshSockFailure("Connection reset by peer")).toBe(false);
  });
});

describe("isSshTamperCommand", () => {
  test("blocks ssh-agent socket/process tampering", () => {
    expect(isSshTamperCommand('rm -f "$SSH_AUTH_SOCK"')).toBe(true);
    expect(isSshTamperCommand("rm -f /tmp/ssh-XXXX/agent.1234")).toBe(true);
    expect(isSshTamperCommand("pkill ssh-agent")).toBe(true);
    expect(isSshTamperCommand("eval $(ssh-agent)")).toBe(true);
    expect(isSshTamperCommand("unset SSH_AUTH_SOCK")).toBe(true);
    expect(isSshTamperCommand("export SSH_AUTH_SOCK=/tmp/new-agent")).toBe(true);
  });

  test("allows benign reads of the agent socket", () => {
    expect(isSshTamperCommand("echo $SSH_AUTH_SOCK")).toBe(false);
    expect(isSshTamperCommand("test -S $SSH_AUTH_SOCK")).toBe(false);
  });
});

describe("sshSockHardStop", () => {
  test("returns a hard-stop directive for an ssh-family socket failure", () => {
    const d = sshSockHardStop(
      "ssh git@github.com",
      "Could not open a connection to your authentication agent.",
    );
    expect(d).not.toBeUndefined();
    expect(String(d)).toContain("[SSH-HARDSTOP]");
    expect(String(d).toUpperCase()).toContain("ASK THE USER");
  });

  test("passes through non-ssh commands and unrelated failures", () => {
    expect(
      sshSockHardStop("ls", "Could not open a connection to your authentication agent."),
    ).toBeUndefined();
    expect(sshSockHardStop("ssh host", "Permission denied (publickey)")).toBeUndefined();
  });
});

describe("SSH_BLOCK_REASON", () => {
  test("is imperative and non-empty", () => {
    expect(SSH_BLOCK_REASON).toContain("BLOCKED:");
    expect(SSH_BLOCK_REASON.length).toBeGreaterThan(50);
  });
});
