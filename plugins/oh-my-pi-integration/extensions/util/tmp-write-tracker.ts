// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 omp-plugins Contributors

/**
 * In-process `.tmp` write tracker — records file writes whose destination
 * lives under `<root>/.tmp/` so the receipt can surface them as session
 * artifacts (`session_artifacts = [".tmp/a", …]` in receipt.toml).
 *
 * Monkey-patches the `node:fs` module exports (writeFileSync, callback
 * writeFile, renameSync, appendFileSync) plus `Bun.write` when available.
 * Purely observational:
 *
 *   - originals are ALWAYS called through (record, then delegate) — errors
 *     propagate exactly as they would unpatched;
 *   - wrappers never throw before delegating (recording is best-effort);
 *   - double install is a no-op; `resetTmpWriteTracker()` restores the
 *     originals (test seam);
 *   - destinations outside `<root>/.tmp/` are ignored;
 *   - `PI_RECEIPT_DISABLE=1` at install time skips patching entirely.
 *
 * Bun's ESM instantiation snapshots named-import bindings, so the patch
 * reaches callers that access these functions as module properties
 * (default-import / require style, `Bun.write(…)`) but cannot rebind
 * named imports captured before the patch. That is the accepted, fail-open
 * best-effort surface.
 *
 * Paths are stored relative to the session root with POSIX separators,
 * deduped in first-seen order, capped at the first TMP_WRITE_TRACKER_MAX
 * entries per drain.
 */

import fs from "node:fs";
import { relative, resolve, sep } from "node:path";

/** Recorded destinations per drain are capped (context-budget guard). */
export const TMP_WRITE_TRACKER_MAX = 20;

/** Patch targets are addressed by name so one installer covers them all. */
type PatchSurface = Record<string, unknown>;

interface TrackerState {
  root: string | undefined;
  installed: boolean;
  recorded: string[];
  seen: Set<string>;
  restorers: Array<() => void>;
}

const state: TrackerState = {
  root: undefined,
  installed: false,
  recorded: [],
  seen: new Set<string>(),
  restorers: [],
};

/** Extract a recordable destination path from a wrapper's arguments. */
function argumentPath(args: unknown[], argument: number): unknown {
  return args[argument];
}

/** Extract the destination from a Bun.write first argument (path or Bun.File). */
function bunDestination(args: unknown[]): unknown {
  const dest = args[0];
  if (typeof dest === "string" || Buffer.isBuffer(dest)) return dest;
  if (dest !== null && typeof dest === "object" && "name" in dest) {
    const name = (dest as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return undefined;
}

/** Best-effort recording of one write destination; never throws. */
function recordDestination(dest: unknown): void {
  try {
    if (!state.installed || state.recorded.length >= TMP_WRITE_TRACKER_MAX) return;
    let path: string | undefined;
    if (typeof dest === "string") path = dest;
    else if (Buffer.isBuffer(dest)) path = dest.toString("utf8");
    if (path === undefined || path === "") return;
    const rel = relative(state.root ?? ".", resolve(path))
      .split(sep)
      .join("/");
    if (!rel.startsWith(".tmp/")) return; // only the tracked .tmp root
    if (state.seen.has(rel)) return;
    state.seen.add(rel);
    state.recorded.push(rel);
  } catch {
    /* tracking must never break the host */
  }
}

/**
 * Wrap one function on a patch surface: record a destination derived from
 * the call arguments, then delegate to the original untouched. Restoration
 * is registered only when the patch actually landed.
 */
function installPatch(
  surface: PatchSurface,
  name: string,
  destinationOf: (args: unknown[]) => unknown,
): void {
  const original = surface[name];
  if (typeof original !== "function") return;
  const wrapper = function (this: unknown, ...args: unknown[]): unknown {
    try {
      recordDestination(destinationOf(args));
    } catch {
      /* never throw from the wrapper before the original runs */
    }
    return (original as (...fnArgs: unknown[]) => unknown).apply(this, args);
  };
  try {
    surface[name] = wrapper;
  } catch {
    return; // read-only surface: skip, never break the host
  }
  state.restorers.push(() => {
    try {
      surface[name] = original;
    } catch {
      /* best effort */
    }
  });
}

/** Whether the tracker is currently installed in this process. */
export function tmpWriteTrackerInstalled(): boolean {
  return state.installed;
}

/**
 * Install the tracker for one session root (assumed stable for the process).
 * Idempotent; no-op when already installed or `PI_RECEIPT_DISABLE=1`.
 */
export function installTmpWriteTracker(root: string): void {
  try {
    if (state.installed) return;
    if (typeof process !== "undefined" && process.env?.PI_RECEIPT_DISABLE === "1") return;

    state.root = resolve(root);
    // The fs default import and require("node:fs") share one exports
    // object in Bun; property assignment is visible to property-access
    // callers (verified empirically — see module doc comment).
    const fsSurface = fs as unknown as PatchSurface;
    installPatch(fsSurface, "writeFileSync", (args) => argumentPath(args, 0));
    installPatch(fsSurface, "writeFile", (args) => argumentPath(args, 0));
    installPatch(fsSurface, "renameSync", (args) => argumentPath(args, 1)); // destination survives
    installPatch(fsSurface, "appendFileSync", (args) => argumentPath(args, 0));

    if (typeof Bun !== "undefined" && typeof Bun.write === "function") {
      const bunSurface = Bun as unknown as PatchSurface;
      installPatch(bunSurface, "write", bunDestination);
    }

    state.installed = true;
  } catch {
    /* tracking is best-effort; never break the host */
  }
}

/** Drain the recorded `.tmp/…` paths (deduped, first-seen order) and clear. */
export function drainTmpWrites(): string[] {
  const out = state.recorded;
  state.recorded = [];
  state.seen.clear();
  return out;
}

/** Uninstall every patch and clear recorded state (test seam). */
export function resetTmpWriteTracker(): void {
  for (const restore of state.restorers.splice(0)) {
    try {
      restore();
    } catch {
      /* best effort */
    }
  }
  state.recorded = [];
  state.seen.clear();
  state.root = undefined;
  state.installed = false;
}
