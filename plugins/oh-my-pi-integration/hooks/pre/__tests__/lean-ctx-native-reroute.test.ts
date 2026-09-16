import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import defaultHook, {
  EDIT_REASON,
  editBlockReason,
  GLOB_REASON,
  globBlockReason,
  WRITE_OUTSIDE_REASON,
  WRITE_REASON,
  writeBlockReason,
} from "../lean-ctx-native-reroute";

// Resource contract: every temp dir is per-test (mkdtempSync) and released in
// afterEach; INSIDE_* fixtures are read-only repo paths — parallel-safe under
// `bun test` file/worker parallelism.

const INSIDE_FILE = resolve(process.cwd(), "package.json");
const INSIDE_ROOT = process.cwd();

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("globBlockReason", () => {
  test("blocks in-root globs toward ctx_glob", () => {
    expect(globBlockReason(INSIDE_FILE)).toEqual({ block: true, reason: GLOB_REASON });
    expect(globBlockReason("src")).toEqual({ block: true, reason: GLOB_REASON });
    // repo-root glob (empty path) is in-root too
    expect(globBlockReason("")).toEqual({ block: true, reason: GLOB_REASON });
  });

  test("exempts outside-root paths and internal URIs (native glob fallback)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lean-ctx-reroute-"));
    tempDirs.push(dir);
    expect(globBlockReason(dir)).toBeUndefined();
    expect(globBlockReason("memory://abc")).toBeUndefined();
  });
});

describe("editBlockReason", () => {
  test("blocks in-root source edits toward ctx_patch", () => {
    expect(editBlockReason(INSIDE_FILE)).toEqual({ block: true, reason: EDIT_REASON });
    expect(editBlockReason(join(INSIDE_ROOT, "a.ts"))).toEqual({
      block: true,
      reason: EDIT_REASON,
    });
    // missing path still nudges toward the anchored flow
    expect(editBlockReason("")).toEqual({ block: true, reason: EDIT_REASON });
  });

  test("keeps exemptions: outside root, internal schemes, non-code files", () => {
    expect(editBlockReason(join(tmpdir(), "outside.txt"))).toBeUndefined();
    expect(editBlockReason("memory://abc")).toBeUndefined();
    expect(editBlockReason(join(INSIDE_ROOT, "logo.png"))).toBeUndefined();
  });
});

describe("writeBlockReason", () => {
  test("blocks in-root non-scratch creation toward ctx_patch", () => {
    expect(writeBlockReason(INSIDE_FILE)).toEqual({ block: true, reason: WRITE_REASON });
    expect(writeBlockReason(join(INSIDE_ROOT, "a.ts"))).toEqual({
      block: true,
      reason: WRITE_REASON,
    });
    // traversal out of the scratch dir resolves back to a non-scratch root file
    expect(writeBlockReason(join(INSIDE_ROOT, ".tmp", "..", "escape.txt"))).toEqual({
      block: true,
      reason: WRITE_REASON,
    });
  });

  test("allows in-root .tmp scratch files at any depth", () => {
    expect(writeBlockReason(join(INSIDE_ROOT, ".tmp", "probe.txt"))).toBeUndefined();
    expect(writeBlockReason(join(INSIDE_ROOT, "pkg", ".tmp", "probe.txt"))).toBeUndefined();
    expect(writeBlockReason(join(INSIDE_ROOT, "pkg", "sub", ".tmp", "probe.txt"))).toBeUndefined();
    expect(writeBlockReason(join(INSIDE_ROOT, ".tmp", "nested", "probe.txt"))).toBeUndefined();
  });

  test("blocks writes outside the project root", () => {
    expect(writeBlockReason(join(tmpdir(), "outside.txt"))).toEqual({
      block: true,
      reason: WRITE_OUTSIDE_REASON,
    });
  });

  test("keeps exemptions: internal schemes, binary/doc extensions, empty path", () => {
    expect(writeBlockReason(join(INSIDE_ROOT, "logo.png"))).toBeUndefined();
    expect(writeBlockReason("memory://abc")).toBeUndefined();
    expect(writeBlockReason("")).toBeUndefined();
  });
});

describe("default hook wiring", () => {
  test("routes glob/edit/write tool calls through the block-reason helpers", () => {
    const hooks = new FakeHooks();
    (defaultHook as unknown as (pi: FakeHooks) => void)(hooks);
    const handler = hooks.handler;
    if (!handler) throw new Error("hook handler not registered");

    expect(handler({ toolName: "glob", input: { path: "src" } })).toEqual({
      block: true,
      reason: GLOB_REASON,
    });
    expect(handler({ toolName: "glob", input: {} })).toEqual({
      block: true,
      reason: GLOB_REASON,
    });
    expect(handler({ toolName: "edit", input: { path: INSIDE_FILE } })).toEqual({
      block: true,
      reason: EDIT_REASON,
    });
    expect(handler({ toolName: "edit", input: {} })).toEqual({
      block: true,
      reason: EDIT_REASON,
    });
    expect(handler({ toolName: "write", input: { path: INSIDE_FILE } })).toEqual({
      block: true,
      reason: WRITE_REASON,
    });
    expect(
      handler({ toolName: "write", input: { path: join(INSIDE_ROOT, ".tmp", "x.txt") } }),
    ).toBeUndefined();

    // read/grep are out of the hook's scope (native stays sanctioned);
    // unrelated tools pass through untouched
    expect(handler({ toolName: "read", input: { path: INSIDE_FILE } })).toBeUndefined();
    expect(handler({ toolName: "grep", input: { path: "src" } })).toBeUndefined();
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
