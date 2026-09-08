// install-lib.ts — TypeScript port of scripts/install.sh (pure, testable core).
//
// The CLI entry point is scripts/install.ts; everything behavioral lives here.
// Semantics mirror install.sh exactly: same flags, exit codes (2 unknown
// option / 3 dangerous or live target / 4 unbootstrapped profiles / 1 missing
// plugin source), same stdout line formats, manifest-driven update/reconcile,
// profile runtime symlinks, plugin lock JSON, and config.yml pattern merging
// (`.merged`-free: the merge result is written atomically via temp+rename).
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/** rel path -> sha256 for files we own, or the literal "dir" marker. */
export type Manifest = Map<string, string | "dir">;

export interface CliFlags {
  target: string;
  force: boolean;
  dryRun: boolean;
  noPlugin: boolean;
  live: boolean;
  help: boolean;
}

/** Error carrying the process exit code install.sh would have used. */
export class InstallerError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "InstallerError";
    this.exitCode = exitCode;
  }
}

export const HELP_TEXT = `# install.ts — Install the oh-my-pi integration bundle into a target omp
# profile root.
#
# Usage:
#   bun scripts/install.ts [--target DIR] [--force] [--dry-run] [--no-plugin] [--live]
#   --target DIR   Where to install. Default: /tmp/omp-test.
#                  Equivalent to setting PREFIX=DIR.
#                  TARGET is a host root that owns an .omp profile; if TARGET
#                  itself is a .omp root (e.g. ~/.omp) the bundle is laid down
#                  directly under it without nesting a second .omp.
#   --force        Overwrite locally-modified or untracked files too
#                  (previous copy kept as <dst>.bak). Default: update only
#                  installer-owned files, keep anything else with a notice.
#   --dry-run      Print what would be written/updated/removed without
#                  touching the filesystem.
#   --no-plugin    Skip registering the plugin package (agent-dir payloads
#                  and rules only).
#   --live         Allow updating a live omp profile under $HOME directly
#                  (e.g. --target ~/.omp or --target "$HOME"). Refused by
# Laydown (relative to TARGET):
#   TARGET/.omp/agent/AGENTS.md                      omp-specific global agent rules
#   TARGET/.omp/agent/config.yml                       agent config scaffold
#   TARGET/.omp/agent/extensions/index.ts              integration extension
#   TARGET/.omp/agent/extensions/guards/{gpg,ssh}-guard.ts
#   TARGET/.omp/agent/hooks/pre/lean-ctx-native-reroute.ts
#   TARGET/.omp/agent/hooks/pre/harness-evasion-guard.ts
#   TARGET/.omp/agent/rules/*.md                       universal project rules (agent-scoped)
#   TARGET/.omp/rules/*.md                            universal project rules (root level, picked up by omp directly)
#   TARGET/.omp/profiles/<name>/agent/config.yml      per-profile config (from repo profiles/<name>/agent/)
#   TARGET/.omp/profiles/<name>/agent/AGENTS.md       per-profile agent rules (from repo profiles/<name>/agent/)
#   TARGET/.omp/profiles/<name>/agent/{rules,hooks,extensions,skills,plugins}
#                                                  symlinks back to ../<x> of the default agent runtime,
#                                                  so every profile sees the canonical content without
#                                                  duplication or drift. See PROFILE-LOADER-RESOLUTION.md.
#   TARGET/.omp/plugins/node_modules/oh-my-pi-integration/   plugin package
#   TARGET/.omp/plugins/omp-plugins.lock.json                enablement state
#   TARGET/.omp/plugins/oh-my-pi-integration.manifest        ownership ledger
# Update semantics (manifest-driven):
#     * files we own but that no longer ship are removed (reconciliation);
#     * files the user modified since install (hash differs), or files we
#       never wrote, are kept with a notice — never clobbered without
#       --force;
#     * --force additionally overwrites locally-modified/untracked files,
#       keeping the previous copy as <dst>.bak.
#   Symlinked destinations/parents are never followed: writes and removals
#   are refused (or the symlink removed under --force), and every touched
#   path is realpath-checked to stay inside TARGET.
`;

// ---- small fs probes -------------------------------------------------------

type LstatKind = "file" | "dir" | "symlink" | "other" | "missing";

function lstatKind(p: string): LstatKind {
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return "symlink";
    if (st.isFile()) return "file";
    if (st.isDirectory()) return "dir";
    return "other";
  } catch {
    return "missing";
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** stat() that follows symlinks — mirrors bash `[[ -f ... ]]`. */
function isFileFollow(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * `realpath -m` port: canonicalize a path that may contain not-yet-existing
 * components. Symlinks in the existing prefix are resolved component-wise;
 * `..` pops the canonical prefix, so it is resolved against symlink targets.
 */
export function realpathMissing(target: string, depth = 0): string {
  if (depth > 40) throw new Error(`too many symbolic links: ${target}`);
  const abs = isAbsolute(target) ? target : resolve(target);
  const parts = abs
    .split("/")
    .slice(1)
    .filter((part) => part.length > 0);
  let resolved = "";
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      resolved = resolved.slice(0, Math.max(resolved.lastIndexOf("/"), 0));
      continue;
    }
    const cur = `${resolved}/${part}`;
    if (lstatKind(cur) !== "symlink") {
      resolved = cur;
      continue;
    }
    const link = readlinkSync(cur);
    const linkAbs = isAbsolute(link) ? link : `${resolved}/${link}`;
    resolved = realpathMissing(linkAbs, depth + 1);
    if (resolved === "/") resolved = "";
  }
  return resolved === "" ? "/" : resolved;
}

/** sha256 of a regular file; "" when missing, a symlink, or a directory. */
export async function fileSha(p: string): Promise<string> {
  if (lstatKind(p) !== "file") return "";
  try {
    const buf = await readFile(p);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

// ---- ownership ledger (manifest) ------------------------------------------

/**
 * Parse a manifest file body: `F <sha> <rel>` for files, `D - <rel>` for
 * directories. Malformed lines are skipped, matching `manifest_load`.
 */
export function parseManifest(text: string): Manifest {
  const manifest: Manifest = new Map();
  for (const rawLine of text.split("\n")) {
    const tokens = rawLine.trim().split(/\s+/);
    if (tokens.length < 3) continue;
    const kind = tokens[0] ?? "";
    const value = tokens[1] ?? "";
    const rel = tokens.slice(2).join(" ");
    if (rel.length === 0) continue;
    if (kind === "F") manifest.set(rel, value);
    else if (kind === "D") manifest.set(rel, "dir");
  }
  return manifest;
}

/** Serialize sorted by rel path, same `F <sha> <rel>` / `D - <rel>` format. */
export function serializeManifest(manifest: Manifest): string {
  const lines: string[] = [];
  for (const rel of [...manifest.keys()].sort()) {
    const value = manifest.get(rel);
    lines.push(value === "dir" ? `D - ${rel}` : `F ${value ?? ""} ${rel}`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

// ---- bashInterceptor pattern merge ----------------------------------------

const BASH_INTERCEPTOR_RE = /^bashInterceptor:\s*$/;
const PATTERNS_KEY_RE = /^\s+patterns:\s*$/;
const PATTERN_ENTRY_RE = /^\s+- pattern:/;
const TOP_LEVEL_RE = /^\S/;

/**
 * Unescape a quoted YAML scalar: single-quoted `''` -> `'`; double-quoted
 * escapes (\\, \", \n, \t, \r, \xNN, \uNNNN) -> their characters. Required so
 * a dst pattern stored as `"^\\s*git..."` compares equal to the same regex
 * stored unquoted in src.
 */
function unescapeYamlScalar(s: string, quote: string): string {
  if (quote === "'") return s.replace(/''/g, "'");
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0"ntr\\])/g, (_m, esc: string) => {
    if (esc[0] === "u" || esc[0] === "x") {
      return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    }
    switch (esc) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        return esc;
    }
  });
}

/**
 * Normalize a `- pattern:` entry line for matching: strip the list marker and
 * key, surrounding quotes (unescaping quoted YAML scalars), and surrounding
 * whitespace. Quote-tolerant: a quoted dst pattern matches an unquoted src
 * pattern and vice versa.
 */
export function normalizePatternLine(line: string): string {
  let s = line.trim();
  const marker = /^-\s*pattern:\s*/.exec(s);
  if (marker !== null) s = s.slice(marker[0]?.length ?? 0).trim();
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if (first === last && (first === '"' || first === "'")) {
      s = unescapeYamlScalar(s.slice(1, -1), first).trim();
    }
  }
  return s;
}

/** Split a `bashInterceptor.patterns` list into verbatim entry blocks. */
function parsePatternBlocks(text: string): string[][] {
  const lines = text.split("\n");
  let start: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!BASH_INTERCEPTOR_RE.test(lines[i] ?? "")) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const probe = lines[j] ?? "";
      if (PATTERNS_KEY_RE.test(probe)) {
        start = j + 1;
        break;
      }
      if (TOP_LEVEL_RE.test(probe)) break;
    }
    break;
  }
  if (start === null) return [];
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (PATTERN_ENTRY_RE.test(line)) {
      if (current !== null) blocks.push(current);
      current = [line];
    } else if (current !== null) {
      if (TOP_LEVEL_RE.test(line)) break; // next top-level key: list ended
      current.push(line);
    } else if (TOP_LEVEL_RE.test(line)) {
      break;
    }
  }
  if (current !== null) blocks.push(current);
  return blocks;
}

export interface MergeResult {
  text: string;
  added: string[];
}

/**
 * Compute the merged config for a user-modified config.yml: append every src
 * `- pattern:` entry whose normalized pattern line is absent from dst at the
 * end of dst's `bashInterceptor.patterns` list. Everything else in dst is
 * preserved byte-for-byte; the result always ends with a newline. Returns
 * null when dst has no patterns list (we do not invent YAML structure).
 */
export function mergeInterceptorPatterns(srcYaml: string, dstYaml: string): MergeResult | null {
  const present = new Set(parsePatternBlocks(dstYaml).map((b) => normalizePatternLine(b[0] ?? "")));
  const missing = parsePatternBlocks(srcYaml).filter(
    (block) => !present.has(normalizePatternLine(block[0] ?? "")),
  );
  if (missing.length === 0) return { text: dstYaml, added: [] };
  const lines = dstYaml.replace(/\n+$/, "").split("\n");
  // Anchor to the bashInterceptor section: never enter list-tracking from an
  // unrelated `patterns:` key elsewhere in the file.
  let bi = -1;
  for (let i = 0; i < lines.length; i++) {
    if (BASH_INTERCEPTOR_RE.test(lines[i] ?? "")) {
      bi = i;
      break;
    }
  }
  let last: number | null = null;
  let inList = false;
  let entryOpen = false;
  for (let i = bi + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (TOP_LEVEL_RE.test(line)) break; // left the bashInterceptor section
    if (PATTERNS_KEY_RE.test(line)) {
      inList = true;
      entryOpen = false;
      continue;
    }
    if (!inList) continue;
    if (PATTERN_ENTRY_RE.test(line)) entryOpen = true;
    if (entryOpen) last = i; // end of the last entry block (pattern + tool/message lines)
  }
  if (!inList || last === null) return null;

  const addition: string[] = [];
  for (const block of missing) addition.push(...block);
  lines.splice(last + 1, 0, ...addition);
  return {
    text: `${lines.join("\n")}\n`,
    added: missing.map((block) => normalizePatternLine(block[0] ?? "")),
  };
}

// ---- CLI arg parsing ------------------------------------------------------

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): CliFlags {
  const flags: CliFlags = {
    target: env.PREFIX || "/tmp/omp-test",
    force: false,
    dryRun: false,
    noPlugin: false,
    live: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--target": {
        const value = argv[i + 1];
        if (value === undefined || value === "") {
          throw new InstallerError("--target requires a path", 1);
        }
        flags.target = value;
        i += 1;
        break;
      }
      case "--force":
        flags.force = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--no-plugin":
        flags.noPlugin = true;
        break;
      case "--live":
        flags.live = true;
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
      default:
        throw new InstallerError(`unknown option: ${arg}`, 2);
    }
  }
  return flags;
}

// ---- installer core -------------------------------------------------------

export interface RunDeps {
  out: (line: string) => void;
  err: (line: string) => void;
  home: string;
}

interface InstallCtx {
  deps: RunDeps;
  flags: CliFlags;
  repoRoot: string;
  target: string;
  ompRoot: string;
  rlob: string;
  agentDir: string;
  rulesDir: string;
  rootRulesDir: string;
  pluginDir: string;
  pluginSrc: string;
  pkgName: string;
  manifestPath: string;
  lockPath: string;
  manifest: Manifest;
  shipped: Map<string, string | "dir">;
  profiles: string[];
  counts: { installed: number; updated: number; unchanged: number; kept: number; removed: number };
}

const PKG_NAME = "oh-my-pi-integration";
const PROFILE_RUNTIME_SUBDIRS = ["rules", "hooks", "extensions", "skills", "plugins"] as const;

const AGENT_PAYLOADS: readonly [string, string][] = [
  ["extensions/index.ts", "extensions/index.ts"],
  ["extensions/util/lint-feedback.ts", "extensions/util/lint-feedback.ts"],
  ["extensions/guards/gpg-guard.ts", "extensions/guards/gpg-guard.ts"],
  ["extensions/guards/ssh-guard.ts", "extensions/guards/ssh-guard.ts"],
  ["extensions/guards/git-destructive-guard.ts", "extensions/guards/git-destructive-guard.ts"],
  ["hooks/pre/lean-ctx-native-reroute.ts", "hooks/pre/lean-ctx-native-reroute.ts"],
  ["hooks/pre/harness-evasion-guard.ts", "hooks/pre/harness-evasion-guard.ts"],
];

function warn(ctx: InstallCtx, message: string): void {
  ctx.deps.err(`  ! ${message}`);
}

function inRealm(ctx: InstallCtx, p: string): boolean {
  try {
    const rp = realpathMissing(p);
    return rp === ctx.target || rp.startsWith(`${ctx.target}/`);
  } catch {
    return false;
  }
}

function atomicWriteText(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function loadManifest(path: string): Manifest {
  if (!isFileFollow(path)) return new Map();
  try {
    return parseManifest(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
}

function listProfiles(repoRoot: string): string[] {
  const base = join(repoRoot, "profiles");
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  return names
    .filter((name) => isDirectory(join(base, name)) && isDirectory(join(base, name, "agent")))
    .sort();
}

function listRuleFiles(pluginSrc: string): string[] {
  const rulesDir = join(pluginSrc, "rules");
  let names: string[];
  try {
    names = readdirSync(rulesDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md") && isFileFollow(join(rulesDir, name)))
    .sort()
    .map((name) => join(rulesDir, name));
}

// mkdir -p dirname(dst), refusing symlinked / out-of-realm parents.
function ensureParent(ctx: InstallCtx, dst: string, rel: string): boolean {
  const parent = dirname(dst);
  if (lstatKind(parent) === "symlink") {
    if (ctx.flags.force) {
      rmSync(parent, { force: true });
    } else {
      warn(ctx, `symlinked parent, keeping: ${rel}`);
      return false;
    }
  }
  if (!inRealm(ctx, parent)) {
    warn(ctx, `parent outside target, keeping: ${rel}`);
    return false;
  }
  if (!ctx.flags.dryRun) mkdirSync(parent, { recursive: true });
  return true;
}

// Write one bundle file (install/update/force-overwrite). True when written.
function doWrite(ctx: InstallCtx, src: string, dst: string, rel: string, action: string): boolean {
  if (lstatKind(dst) === "symlink") {
    if (ctx.flags.force) {
      rmSync(dst, { force: true });
    } else {
      warn(ctx, `symlinked dst, keeping: ${rel}`);
      return false;
    }
  }
  if (!ensureParent(ctx, dst, rel)) return false;
  if (ctx.flags.dryRun) {
    ctx.deps.out(`  + ${rel} (${action})`);
    return true;
  }
  const kind = lstatKind(dst);
  if (kind === "dir") {
    rmSync(dst, { recursive: true });
  } else if (kind !== "missing") {
    try {
      copyFileSync(dst, `${dst}.bak`);
    } catch {
      // best-effort backup, like `cp -p ... || true`
    }
  }
  copyFileSync(src, dst);
  ctx.deps.out(`  + ${rel} (${action})`);
  return true;
}

// Replace a bundle-owned directory: move-aside then copy, ship runtime files only.
function doReplaceDir(
  ctx: InstallCtx,
  src: string,
  dst: string,
  rel: string,
  action: string,
): boolean {
  if (!inRealm(ctx, dst)) {
    warn(ctx, `outside target, keeping: ${rel}`);
    return false;
  }
  if (!ensureParent(ctx, dst, rel)) return false;
  if (ctx.flags.dryRun) {
    ctx.deps.out(`  + ${rel}/ (${action})`);
    return true;
  }
  if (existsSync(dst) || lstatKind(dst) === "symlink") {
    rmSync(`${dst}.bak`, { recursive: true, force: true });
    renameSync(dst, `${dst}.bak`);
  }
  cpSync(src, dst, { recursive: true });
  pruneShippedTree(dst);
  ctx.deps.out(`  + ${rel}/ (${action})`);
  return true;
}

// omp walks the package tree and loads any *.ts: dev-only unit tests and
// leftover .bak/.original files must never ship. Also chmod -R u+w.
function pruneShippedTree(root: string): void {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() ?? "";
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") {
          rmSync(p, { recursive: true, force: true });
          continue;
        }
        try {
          addUWrite(p);
        } catch {
          // ignore chmod failures on odd fs nodes
        }
        stack.push(p);
        continue;
      }
      if (entry.name.endsWith(".bak") || entry.name.endsWith(".original")) {
        rmSync(p, { force: true });
        continue;
      }
      try {
        addUWrite(p);
      } catch {
        // ignore chmod failures (e.g. dangling symlinks)
      }
    }
  }
}

function addUWrite(p: string): void {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) return; // never chmod through symlinks
  chmodSync(p, st.mode | 0o200);
}

async function mergeConfigPatterns(
  ctx: InstallCtx,
  src: string,
  dst: string,
  rel: string,
): Promise<void> {
  if (lstatKind(dst) === "symlink") {
    warn(ctx, `symlinked config, keeping: ${rel}`);
    return;
  }
  if (!isFileFollow(src) || !isFileFollow(dst)) return;
  const result = mergeInterceptorPatterns(readFileSync(src, "utf8"), readFileSync(dst, "utf8"));
  if (result === null || result.added.length === 0) return;
  if (ctx.flags.dryRun) {
    ctx.deps.out(`  ~ would merge interceptor patterns into: ${rel}`);
    for (const pattern of result.added) ctx.deps.out(`      + ${pattern}`);
    return;
  }
  try {
    copyFileSync(dst, `${dst}.bak`);
  } catch {
    // best-effort backup
  }
  atomicWriteText(dst, result.text);
  ctx.deps.out(`  ~ merged interceptor patterns into: ${rel}`);
  for (const pattern of result.added) ctx.deps.out(`      + ${pattern}`);
  warn(ctx, `config kept + merged (user-modified); backup at ${dst}.bak`);
}

// ---- sync one bundle file -------------------------------------------------

async function syncFile(ctx: InstallCtx, src: string, dst: string, rel: string): Promise<void> {
  const srcSha = await fileSha(src);
  ctx.shipped.set(rel, srcSha);
  const { manifest, counts, flags, deps } = ctx;
  if (!existsSync(dst) && lstatKind(dst) !== "symlink") {
    if (doWrite(ctx, src, dst, rel, "install")) {
      manifest.set(rel, srcSha);
      counts.installed += 1;
    }
    return;
  }
  const owned = manifest.get(rel);
  if (typeof owned === "string" && owned !== "dir") {
    const curSha = await fileSha(dst);
    if (curSha === owned) {
      if (srcSha === owned) {
        counts.unchanged += 1;
        deps.out(`  = ${rel} (up to date)`);
      } else if (doWrite(ctx, src, dst, rel, "update")) {
        manifest.set(rel, srcSha);
        counts.updated += 1;
      }
    } else if (flags.force) {
      warn(ctx, `force-overwriting locally-modified: ${rel}`);
      if (doWrite(ctx, src, dst, rel, "force-overwrite")) {
        manifest.set(rel, srcSha);
        counts.updated += 1;
      }
    } else {
      warn(ctx, `modified locally, keeping: ${rel}`);
      if (rel.endsWith("config.yml")) await mergeConfigPatterns(ctx, src, dst, rel);
      counts.kept += 1;
    }
    return;
  }
  if (owned === "dir") {
    if (doReplaceDir(ctx, src, dst, rel, "update")) counts.updated += 1;
    return;
  }
  if (flags.force) {
    warn(ctx, `force-overwriting untracked: ${rel}`);
    if (doWrite(ctx, src, dst, rel, "force-overwrite")) {
      manifest.set(rel, srcSha);
      counts.updated += 1;
    }
  } else {
    warn(ctx, `exists, keeping: ${rel}`);
    counts.kept += 1;
  }
}

// ---- sync one bundle-owned directory --------------------------------------

function syncDir(ctx: InstallCtx, src: string, dst: string, rel: string): void {
  ctx.shipped.set(rel, "dir");
  const { manifest, counts, flags } = ctx;
  if (!existsSync(dst) && lstatKind(dst) !== "symlink") {
    if (doReplaceDir(ctx, src, dst, rel, "install")) {
      manifest.set(rel, "dir");
      counts.installed += 1;
    }
    return;
  }
  if (manifest.get(rel) === "dir") {
    if (doReplaceDir(ctx, src, dst, rel, "update")) counts.updated += 1;
  } else if (existsSync(ctx.lockPath)) {
    warn(ctx, `adopting pre-manifest install (lockfile present): ${rel}`);
    if (doReplaceDir(ctx, src, dst, rel, "update")) {
      manifest.set(rel, "dir");
      counts.updated += 1;
    }
  } else if (flags.force) {
    warn(ctx, `force-replacing untracked dir: ${rel}`);
    if (doReplaceDir(ctx, src, dst, rel, "force-replace")) {
      manifest.set(rel, "dir");
      counts.updated += 1;
    }
  } else {
    warn(ctx, `exists, keeping: ${rel}/`);
    counts.kept += 1;
  }
}

// ---- sections -------------------------------------------------------------

async function syncAgentPayloads(ctx: InstallCtx): Promise<void> {
  ctx.deps.out("==> agent profile payloads");
  await syncFile(
    ctx,
    join(ctx.repoRoot, "AGENTS.md"),
    join(ctx.agentDir, "AGENTS.md"),
    `${ctx.rlob}agent/AGENTS.md`,
  );
  await syncFile(
    ctx,
    join(ctx.repoRoot, "agent", "config.yml"),
    join(ctx.agentDir, "config.yml"),
    `${ctx.rlob}agent/config.yml`,
  );
  for (const [srcRel, dstRel] of AGENT_PAYLOADS) {
    await syncFile(
      ctx,
      join(ctx.pluginSrc, srcRel),
      join(ctx.agentDir, dstRel),
      `${ctx.rlob}agent/${dstRel}`,
    );
  }
}

async function syncRules(ctx: InstallCtx): Promise<void> {
  if (!isDirectory(join(ctx.pluginSrc, "rules"))) return;
  ctx.deps.out("==> universal project rules");
  for (const rulePath of listRuleFiles(ctx.pluginSrc)) {
    const name = basename(rulePath);
    await syncFile(ctx, rulePath, join(ctx.rulesDir, name), `${ctx.rlob}agent/rules/${name}`);
    await syncFile(ctx, rulePath, join(ctx.rootRulesDir, name), `${ctx.rlob}rules/${name}`);
  }
}

async function syncProfilePayloads(ctx: InstallCtx): Promise<void> {
  if (ctx.profiles.length === 0) return;
  ctx.deps.out("==> per-profile payloads");
  for (const name of ctx.profiles) {
    const profileAgentDir = join(ctx.ompRoot, "profiles", name, "agent");
    const srcDir = join(ctx.repoRoot, "profiles", name, "agent");
    let srcNames: string[];
    try {
      srcNames = readdirSync(srcDir);
    } catch {
      srcNames = [];
    }
    if (!isDirectory(profileAgentDir)) {
      if (srcNames.length === 0) {
        continue;
      }
      if (!ctx.flags.dryRun) {
        mkdirSync(profileAgentDir, { recursive: true });
      } else {
        ctx.deps.out(`  + mkdir ${profileAgentDir} (bootstrap from repo source)`);
      }
    }
    ctx.deps.out(`    profile: ${name}`);
    for (const base of srcNames.sort()) {
      const srcFile = join(srcDir, base);
      if (!isFileFollow(srcFile)) continue;
      if (base !== "config.yml" && base !== "AGENTS.md") continue;
      await syncFile(
        ctx,
        srcFile,
        join(profileAgentDir, base),
        `${ctx.rlob}profiles/${name}/agent/${base}`,
      );
    }
  }
}

function syncProfileSymlinks(ctx: InstallCtx): void {
  if (ctx.profiles.length === 0) return;
  for (const name of ctx.profiles) {
    const profileAgentDir = join(ctx.ompRoot, "profiles", name, "agent");
    if (!isDirectory(profileAgentDir)) {
      // syncProfilePayloads is responsible for bootstrapping; if it skipped
      // this profile (no repo source and no dst), symlinks have nothing to
      // attach to. Silently no-op — the gate already surfaced empty profiles.
      continue;
    }
    ctx.deps.out(`==> profile runtime symlinks: ${name}`);
    for (const sub of PROFILE_RUNTIME_SUBDIRS) {
      const linkPath = join(profileAgentDir, sub);
      if (!isDirectory(join(ctx.agentDir, sub))) continue;
      if (existsSync(linkPath) || lstatKind(linkPath) === "symlink") continue;
      const linkValue = `../../../agent/${sub}`;
      if (ctx.flags.dryRun) {
        ctx.deps.out(`  + symlink ${linkPath} -> ${linkValue}`);
        continue;
      }
      let realmOk = false;
      try {
        realmOk = inRealm(ctx, realpathMissing(join(dirname(linkPath), "..", "..", "..", "agent")));
      } catch {
        realmOk = false;
      }
      if (!realmOk) {
        warn(
          ctx,
          `skipping symlink ${linkPath} -> ${join(ctx.agentDir, sub)} (target outside realm)`,
        );
        continue;
      }
      symlinkSync(linkValue, linkPath);
      ctx.deps.out(`  + symlink ${linkPath} -> ${linkValue}`);
    }
  }
}

type LockDoc = Record<string, unknown> & {
  version?: unknown;
  plugins?: unknown;
  settings?: unknown;
};

function readLock(path: string): LockDoc {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as LockDoc;
    }
  } catch {
    // corrupt or unreadable lockfile: start from the default document
  }
  return { version: 1, plugins: {}, settings: {} };
}

function ensureRecord(doc: LockDoc, key: string): Record<string, unknown> {
  const value = doc[key];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  doc[key] = created;
  return created;
}

function syncPluginPackage(ctx: InstallCtx): void {
  if (ctx.flags.noPlugin) return;
  const { flags, deps, lockPath, pkgName, pluginDir } = ctx;
  deps.out("==> plugin package registration");
  syncDir(
    ctx,
    ctx.pluginSrc,
    join(pluginDir, "node_modules", pkgName),
    `${ctx.rlob}plugins/node_modules/${pkgName}`,
  );
  if (existsSync(lockPath) && !flags.force) {
    warn(ctx, `existing plugin lockfile kept: ${lockPath} (use --force to re-enable)`);
    return;
  }
  if (flags.dryRun) {
    deps.out(`  + ${lockPath}  ({"version":1,"plugins":{"${pkgName}":{"enabled":true}}})`);
    return;
  }
  mkdirSync(pluginDir, { recursive: true });
  const data = readLock(lockPath);
  const plugins = ensureRecord(data, "plugins");
  plugins[pkgName] = { enabled: true, enabledFeatures: null };
  const settings = ensureRecord(data, "settings");
  if (settings[pkgName] === undefined) settings[pkgName] = {};
  writeFileSync(lockPath, JSON.stringify(data, null, 2));
  deps.out(`  + ${lockPath}  (${pkgName} enabled)`);
}

// ---- reconciliation -------------------------------------------------------

async function reconcile(ctx: InstallCtx): Promise<void> {
  const { manifest, shipped, counts, flags, deps, target } = ctx;
  for (const rel of [...manifest.keys()].sort()) {
    if (shipped.has(rel)) continue;
    const owned = manifest.get(rel);
    manifest.delete(rel);
    const dst = join(target, rel);
    if (typeof owned === "string" && owned !== "dir") {
      if (!existsSync(dst) && lstatKind(dst) !== "symlink") {
        deps.out(`  - ${rel} (already gone)`);
        continue;
      }
      const curSha = await fileSha(dst);
      if (curSha === owned) {
        if (inRealm(ctx, dst)) {
          if (!flags.dryRun) rmSync(dst, { force: true });
          deps.out(`  - ${rel} (no longer shipped)`);
          counts.removed += 1;
        } else {
          warn(ctx, `outside target, keeping: ${rel}`);
          counts.kept += 1;
        }
      } else {
        warn(ctx, `no longer shipped but modified locally, keeping: ${rel}`);
        counts.kept += 1;
      }
      continue;
    }
    if (flags.noPlugin) {
      warn(ctx, `plugin package not reconciled (--no-plugin): ${rel}`);
      manifest.set(rel, "dir"); // bash keeps the entry in this case
      continue;
    }
    if (inRealm(ctx, dst)) {
      if (!flags.dryRun) rmSync(dst, { recursive: true, force: true });
      deps.out(`  - ${rel}/ (no longer shipped)`);
      counts.removed += 1;
    } else {
      warn(ctx, `outside target, keeping: ${rel}`);
      counts.kept += 1;
    }
  }
}

function saveManifest(ctx: InstallCtx): void {
  if (ctx.flags.dryRun) return;
  mkdirSync(ctx.pluginDir, { recursive: true });
  atomicWriteText(ctx.manifestPath, serializeManifest(ctx.manifest));
}

function printSummary(ctx: InstallCtx): void {
  const { installed, updated, unchanged, kept, removed } = ctx.counts;
  ctx.deps.out("");
  ctx.deps.out(
    `==> summary: ${installed} installed, ${updated} updated, ${unchanged} up to date, ${kept} kept, ${removed} removed`,
  );
  if (ctx.flags.dryRun) {
    ctx.deps.out("==> dry-run complete (no files written)");
    return;
  }
  ctx.deps.out(`==> installed to ${ctx.target}`);
  ctx.deps.out("");
  ctx.deps.out("Next steps:");
  ctx.deps.out(`  omp --profile test      # or point omp at ${ctx.target}/.omp/agent`);
  ctx.deps.out("  export PI_INTEGRATION_RETRIEVE=1   # enable engram turn-start retrieval");
  ctx.deps.out("  export PI_INTEGRATION_DISABLE=1    # disable the whole extension");
}

// ---- startup gates (order matches install.sh) -----------------------------

/** Refuse unsafe --target values. Returns null when safe, else a reason. */
export function checkDangerousTarget(target: string, home: string): string | null {
  if (target === "" || target === "/") return "target is the filesystem root or empty";
  if (target === "/root" || target.startsWith("/root/"))
    return "target is another user's home (/root)";
  if (target === "/home" || target === "/home/") return "target is the /home directory";
  if (target.startsWith("/home/")) {
    const other = target.match(/^\/home\/([^/]+)(?:\/|$)/)?.[1];
    if (other !== undefined && other !== basename(home))
      return `target is another user's home (/home/${other}/)`;
  }
  // OS-managed read-only paths. User-writable trees are intentionally NOT
  // denied because the installer may legitimately land in them; the
  // existing symlink + realm guards already prevent cross-user escapes.
  for (const prefix of [
    "/etc",
    "/sys",
    "/proc",
    "/dev",
    "/boot",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/snap",
  ]) {
    if (target === prefix || target.startsWith(`${prefix}/`))
      return `target is under a system path (${prefix})`;
  }
  return null;
}

function runGates(ctx: InstallCtx): number | null {
  const { deps, flags, target } = ctx;
  const homeOmp = join(deps.home, ".omp");
  const underLiveProfile =
    target === deps.home || target === homeOmp || target.startsWith(`${homeOmp}/`);
  if (underLiveProfile && !target.startsWith(`${join(deps.home, ".omp-test")}/`) && !flags.live) {
    deps.err(`ERROR: refusing to install over your live omp profile (${target}).`);
    deps.err("       Pass --live to update your live profile directly, or use an");
    deps.err("       isolated target, e.g.  --target /tmp/omp-test");
    return 3;
  }
  if (flags.live && (target === deps.home || target.startsWith(homeOmp))) {
    deps.out(`    [live] updating your live profile under ${deps.home}/.omp`);
  }
  const danger = checkDangerousTarget(target, deps.home);
  if (danger !== null) {
    deps.err(`ERROR: refusing dangerous target: ${target}`);
    deps.err(`       ${danger}`);
    deps.err("       Pass an isolated target (e.g. --target /tmp/omp-test), or");
    deps.err("       pass --live if you intentionally mean to update your live");
    deps.err("       ~/.omp profile.");
    return 3;
  }
  const emptyProfiles = ctx.profiles.filter((name) => {
    const srcDir = join(ctx.repoRoot, "profiles", name, "agent");
    let srcNames: string[] = [];
    try {
      srcNames = readdirSync(srcDir).filter((b) => b === "config.yml" || b === "AGENTS.md");
    } catch {
      srcNames = [];
    }
    const dstDir = join(ctx.ompRoot, "profiles", name, "agent");
    return srcNames.length === 0 && !isDirectory(dstDir);
  });
  if (emptyProfiles.length > 0) {
    deps.err(
      `ERROR: ${emptyProfiles.length} profile(s) ship in this repo with no installable payload (no config.yml / AGENTS.md in repo source, and no bootstrap dir on disk):`,
    );
    for (const name of emptyProfiles) deps.err(`       - ${name}`);
    deps.err(' Bootstrap with: omp --profile <name> -p ""  or delete the profile from the repo.');
    return 4;
  }
  return null;
}

function defaultDeps(): RunDeps {
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    home: homedir(),
  };
}

/**
 * Full installer run: parse args, run gates, lay down the bundle, reconcile,
 * print the summary. Returns the process exit code (0 on success).
 */
export async function runInstall(argv: string[], deps: RunDeps = defaultDeps()): Promise<number> {
  const flags = parseArgs(argv);
  if (flags.help) {
    deps.out(HELP_TEXT);
    return 0;
  }
  const target = realpathMissing(flags.target);
  const repoRoot = realpathMissing(join(import.meta.dir, ".."));
  const ompRoot = basename(target) === ".omp" ? target : join(target, ".omp");
  const pluginDir = join(ompRoot, "plugins");
  const ctx: InstallCtx = {
    deps,
    flags,
    repoRoot,
    target,
    ompRoot,
    rlob: ompRoot === target ? "" : ".omp/",
    agentDir: join(ompRoot, "agent"),
    rulesDir: join(ompRoot, "agent", "rules"),
    rootRulesDir: join(ompRoot, "rules"),
    pluginDir,
    pluginSrc: join(repoRoot, "plugins", PKG_NAME),
    pkgName: PKG_NAME,
    manifestPath: join(pluginDir, `${PKG_NAME}.manifest`),
    lockPath: join(pluginDir, "omp-plugins.lock.json"),
    manifest: loadManifest(join(pluginDir, `${PKG_NAME}.manifest`)),
    shipped: new Map(),
    profiles: listProfiles(repoRoot),
    counts: { installed: 0, updated: 0, unchanged: 0, kept: 0, removed: 0 },
  };
  deps.out("==> oh-my-pi integration bundle installer");
  deps.out(`    target : ${target}`);
  deps.out(`    source : ${repoRoot}`);
  const gate = runGates(ctx);
  if (gate !== null) return gate;
  await syncAgentPayloads(ctx);
  await syncRules(ctx);
  await syncProfilePayloads(ctx);
  syncProfileSymlinks(ctx);
  syncPluginPackage(ctx);
  await reconcile(ctx);
  saveManifest(ctx);
  printSummary(ctx);
  return 0;
}
