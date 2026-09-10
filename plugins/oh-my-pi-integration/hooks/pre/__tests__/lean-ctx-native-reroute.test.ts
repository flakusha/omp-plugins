import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import defaultHook, {
  EDIT_REASON,
  editBlockReason,
  GLOB_REASON,
  GREP_REASON,
  globBlockReason,
  grepBlockReason,
  READ_FILE_REASON,
  readBlockReason,
} from "../lean-ctx-native-reroute";

const INSIDE_FILE = resolve(process.cwd(), "package.json");
const INSIDE_ROOT = process.cwd();

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readBlockReason", () => {
  test("blocks plain in-root file and directory reads", () => {
    expect(readBlockReason(INSIDE_FILE)?.block).toBe(true);
    expect(readBlockReason(process.cwd())?.block).toBe(true);
    expect(globBlockReason(INSIDE_FILE)?.reason).toBe(GLOB_REASON);
  });

  test("exempts paths outside the project root (native read fallback)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lean-ctx-reroute-"));
    tempDirs.push(dir);
    const file = join(dir, "f.txt");
    writeFileSync(file, "x");
    expect(readBlockReason(file)).toBeUndefined();
    expect(grepBlockReason(dir)).toBeUndefined();
    expect(globBlockReason(dir)).toBeUndefined();
  });

  test("exempts internal URIs", () => {
    expect(readBlockReason("memory://abc")).toBeUndefined();
    expect(readBlockReason("skill://lean-ctx/SKILL.md")).toBeUndefined();
    expect(grepBlockReason("history://x")).toBeUndefined();
  });

  test("lets unresolvable in-root paths through to the native tool error", () => {
    expect(readBlockReason(resolve(process.cwd(), "no/such/file.txt"))).toBeUndefined();
  });

  test("reports the ctx_* destination", () => {
    expect(readBlockReason(INSIDE_FILE)?.reason).toBe(READ_FILE_REASON);
    expect(grepBlockReason("")?.reason).toBe(GREP_REASON);
  });

  test("strips read-tool selector suffixes before the filesystem checks", () => {
    // file.ts:50-200 / :raw / :img?q= are path syntax, not paths —
    // statSync on the raw string fails and selector reads would bypass.
    expect(readBlockReason(`${INSIDE_FILE}:50-200`)?.block).toBe(true);
    expect(readBlockReason(`${INSIDE_FILE}:raw`)?.block).toBe(true);
    expect(readBlockReason(`${INSIDE_FILE}:img?q=x`)?.reason).toBe(READ_FILE_REASON);
    expect(readBlockReason(`${process.cwd()}:1-9`)?.block).toBe(true);
  });
});

describe("default hook wiring", () => {
  test("routes read/grep/glob tool calls through the block-reason helpers", async () => {
    const hooks = new FakeHooks();
    (defaultHook as unknown as (pi: FakeHooks) => void)(hooks);
    expect(hooks.handler).toBeDefined();
    const handler = hooks.handler!;

    const readBlock = handler({ toolName: "read", input: { path: INSIDE_FILE } });
    expect(readBlock).toEqual({ block: true, reason: READ_FILE_REASON });

    const grepBlock = handler({ toolName: "grep", input: { path: "src" } });
    expect(grepBlock).toEqual({ block: true, reason: GREP_REASON });

    const globBlock = handler({ toolName: "glob", input: { path: "" } });
    expect(globBlock).toEqual({ block: true, reason: GLOB_REASON });

    // exempt + unrelated tools pass through
    expect(handler({ toolName: "read", input: { path: "logo.png" } })).toBeUndefined();
    expect(handler({ toolName: "bash", input: { command: "ls" } })).toBeUndefined();
    expect(handler({ toolName: "read", input: {} })).toBeUndefined();
  });
});

class FakeHooks {
  handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | undefined;
  on(_event: string, handler: typeof FakeHooks.prototype.handler): void {
    this.handler = handler;
  }
}

describe("editBlockReason", () => {
  test("blocks in-root source edits toward ctx_patch", () => {
    expect(editBlockReason(INSIDE_FILE)).toEqual({ block: true, reason: EDIT_REASON });
    expect(editBlockReason(join(INSIDE_ROOT, "a.ts"))).toEqual({
      block: true,
      reason: EDIT_REASON,
    });
  });

  test("keeps exemptions: outside root, internal schemes, non-code files", () => {
    expect(editBlockReason(join(tmpdir(), "outside.txt"))).toBeUndefined();
    expect(editBlockReason("memory://abc")).toBeUndefined();
    expect(editBlockReason(join(INSIDE_ROOT, "logo.png"))).toBeUndefined();
  });

  test("default hook routes edit tool calls", async () => {
    const hooks = new FakeHooks();
    (defaultHook as unknown as (pi: FakeHooks) => void)(hooks);
    const result = hooks.handler?.({ toolName: "edit", input: { path: INSIDE_FILE } });
    expect(result).toEqual({ block: true, reason: EDIT_REASON });
    expect(hooks.handler?.({ toolName: "edit", input: {} })).toEqual({
      block: true,
      reason: EDIT_REASON,
    });
    expect(hooks.handler?.({ toolName: "write", input: { path: INSIDE_FILE } })).toBeUndefined();
  });
});
