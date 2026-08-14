import { describe, expect, test } from "bun:test";
import {
  GPG_BLOCK_REASON,
  gpgSignHardStop,
  isGpgSignFailure,
  isGpgTamperCommand,
} from "../gpg-guard";

describe("isGpgSignFailure", () => {
  test("matches signing/locked-key failure markers", () => {
    expect(isGpgSignFailure("gpg: signing failed: secret key not available")).toBe(true);
    expect(isGpgSignFailure("gpg: failed to sign the data")).toBe(true);
    expect(isGpgSignFailure("error: gpg failed to sign the data")).toBe(true);
    expect(isGpgSignFailure("gpg: signing failed: inappropriate ioctl for device")).toBe(true);
    expect(isGpgSignFailure("gpg: cannot open pinentry")).toBe(true);
    expect(isGpgSignFailure("commit signing failed")).toBe(true);
  });

  test("does not match benign or unrelated output", () => {
    expect(isGpgSignFailure("nothing to commit, working tree clean")).toBe(false);
    expect(isGpgSignFailure("gpg: Good signature from flak")).toBe(false);
    expect(isGpgSignFailure("")).toBe(false);
  });
});

describe("isGpgTamperCommand", () => {
  test("blocks gpg-agent lifecycle and passphrase-bypass commands", () => {
    expect(isGpgTamperCommand("gpgconf --kill gpg-agent")).toBe(true);
    expect(isGpgTamperCommand("gpgconf --launch gpg-agent")).toBe(true);
    expect(isGpgTamperCommand("pkill gpg-agent")).toBe(true);
    expect(isGpgTamperCommand("killall gpg-agent")).toBe(true);
    expect(isGpgTamperCommand("systemctl restart gpg-agent")).toBe(true);
    expect(isGpgTamperCommand("gpg-connect-agent killagent /bye")).toBe(true);
    expect(isGpgTamperCommand("gpg --pinentry-mode loopback --sign")).toBe(true);
  });

  test("allows benign reads of gpg configuration", () => {
    expect(isGpgTamperCommand("gpgconf --check-options")).toBe(false);
    expect(isGpgTamperCommand("gpg --version")).toBe(false);
    expect(isGpgTamperCommand("ls ~/.gnupg")).toBe(false);
  });
});

describe("gpgSignHardStop", () => {
  test("returns a hard-stop directive for a failed commit signing", () => {
    const d = gpgSignHardStop("git commit -m done", "error: gpg: signing failed: no secret key");
    expect(d).not.toBeUndefined();
    expect(String(d)).toContain("[GPGSIGN-HARDSTOP]");
    expect(String(d).toUpperCase()).toContain("ASK THE USER");
  });

  test("passes through non-commit commands untouched", () => {
    expect(gpgSignHardStop("ls", "gpg: signing failed")).toBeUndefined();
    expect(gpgSignHardStop("git commit -m x", "all good")).toBeUndefined();
  });
});

describe("GPG_BLOCK_REASON", () => {
  test("is imperative and non-empty", () => {
    expect(GPG_BLOCK_REASON).toContain("BLOCKED:");
    expect(GPG_BLOCK_REASON.length).toBeGreaterThan(50);
  });
});
