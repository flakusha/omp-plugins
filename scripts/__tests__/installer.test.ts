import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  assembleProfileConfig,
  fileSha,
  InstallerError,
  mergeInterceptorPatterns,
  normalizePatternLine,
  parseArgs,
  parseManifest,
  realpathMissing,
  runInstall,
  serializeManifest,
} from "../install-lib";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- manifest -------------------------------------------------------------

describe("parseManifest / serializeManifest", () => {
  const SHA_A = "a".repeat(64);
  const SHA_B = "b".repeat(64);

  test("round-trips file and dir entries sorted by rel path", () => {
    const text = [
      `F ${SHA_A} agent/AGENTS.md`,
      `F ${SHA_B} .omp/rules/boundary-value-handling.md`,
      "D - plugins/node_modules/oh-my-pi-integration",
      "",
    ].join("\n");
    const manifest = parseManifest(text);
    expect(manifest.size).toBe(3);
    expect(manifest.get("agent/AGENTS.md")).toBe(SHA_A);
    expect(manifest.get(".omp/rules/boundary-value-handling.md")).toBe(SHA_B);
    expect(manifest.get("plugins/node_modules/oh-my-pi-integration")).toBe("dir");

    const out = serializeManifest(manifest);
    expect(out.split("\n").filter((line) => line.length > 0)).toEqual([
      `F ${SHA_B} .omp/rules/boundary-value-handling.md`,
      `F ${SHA_A} agent/AGENTS.md`,
      "D - plugins/node_modules/oh-my-pi-integration",
    ]);
    expect(parseManifest(out)).toEqual(manifest);
  });

  test("keeps rel paths containing spaces intact", () => {
    const manifest = parseManifest(`F ${SHA_A} my dir/file.yml\n`);
    expect(manifest.get("my dir/file.yml")).toBe(SHA_A);
  });

  test("skips malformed lines, empty rel, and empty input", () => {
    expect(parseManifest("")).toEqual(new Map());
    expect(parseManifest("garbage\nF onlytwo\nF\nX 1 y\n").size).toBe(0);
  });

  test("serializes an empty manifest to an empty string", () => {
    expect(serializeManifest(new Map())).toBe("");
  });
});

// ---- normalizePatternLine ---------------------------------------------------

describe("normalizePatternLine", () => {
  test("strips list marker, key, and surrounding whitespace", () => {
    expect(normalizePatternLine("- pattern: ^\\s*git\\s+push")).toBe("^\\s*git\\s+push");
    expect(normalizePatternLine("    - pattern:    ^\\s*ls\\s+   ")).toBe("^\\s*ls\\s+");
  });

  test("strips surrounding double and single quotes", () => {
    expect(normalizePatternLine('- pattern: "^\\s*git\\s+stash"')).toBe("^\\s*git\\s+stash");
    expect(normalizePatternLine("- pattern: '^\\s*lean-ctx\\s+-c'")).toBe("^\\s*lean-ctx\\s+-c");
    expect(normalizePatternLine('- pattern:  "  padded  "  ')).toBe("padded");
  });

  test("leaves bare pattern lines intact", () => {
    expect(normalizePatternLine("^\\s*cat\\s+")).toBe("^\\s*cat\\s+");
    expect(normalizePatternLine("  ^\\s*cat\\s+  ")).toBe("^\\s*cat\\s+");
  });
});

// ---- mergeInterceptorPatterns ---------------------------------------------

const SRC_YAML = [
  "bashInterceptor:",
  "  patterns:",
  "    - pattern: ^\\s*git\\s+push",
  "      tool: ask",
  "    - pattern: ^\\s*git\\s+stash",
  "      tool: ask",
].join("\n");

function dstYaml(patternLine: string): string {
  return [
    "theme: tundra",
    "modelRoles:",
    "  default: m3",
    "bashInterceptor:",
    "  enabled: true",
    "  patterns:",
    `    - pattern: ${patternLine}`,
    "      tool: read",
    "astGrep:",
    "  enabled: true",
    "",
  ].join("\n");
}

describe("mergeInterceptorPatterns", () => {
  test("appends missing src entries at the end of dst patterns list", () => {
    const result = mergeInterceptorPatterns(SRC_YAML, dstYaml("^\\s*cat\\s+"));
    expect(result?.added).toEqual(["^\\s*git\\s+push", "^\\s*git\\s+stash"]);
    // byte-expectation: dst bytes everywhere except the two appended blocks
    expect(result?.text).toBe(
      [
        "theme: tundra",
        "modelRoles:",
        "  default: m3",
        "bashInterceptor:",
        "  enabled: true",
        "  patterns:",
        "    - pattern: ^\\s*cat\\s+",
        "      tool: read",
        "    - pattern: ^\\s*git\\s+push",
        "      tool: ask",
        "    - pattern: ^\\s*git\\s+stash",
        "      tool: ask",
        "astGrep:",
        "  enabled: true",
        "",
      ].join("\n"),
    );
    expect(result?.text.startsWith("theme: tundra\nmodelRoles:\n  default: m3\n")).toBe(true);
    expect(result?.text.endsWith("astGrep:\n  enabled: true\n")).toBe(true);
  });

  test("is a no-op when every src pattern is already present", () => {
    const dst = [
      "keepA: 1",
      "bashInterceptor:",
      "  patterns:",
      '    - pattern: "^\\s*git\\s+push"',
      "      tool: ask",
      "    - pattern: ^\\s*git\\s+stash",
      "      tool: read",
      "keepZ: 9",
      "",
    ].join("\n");
    const result = mergeInterceptorPatterns(SRC_YAML, dst);
    expect(result?.added).toEqual([]);
    expect(result?.text).toBe(dst);
  });

  const SRC_STASH = [
    "bashInterceptor:",
    "  patterns:",
    "    - pattern: ^\\s*git\\s+stash",
    "      tool: ask",
  ].join("\n");
  const SRC_STASH_QUOTED = SRC_STASH.replace(
    "- pattern: ^\\s*git\\s+stash",
    '- pattern: "^\\s*git\\s+stash"',
  );

  test("quote-style mismatch still counts as present (both directions)", () => {
    // dst quoted, src unquoted
    const dstQuoted = dstYaml('"^\\s*git\\s+stash"');
    const quotedResult = mergeInterceptorPatterns(SRC_STASH, dstQuoted);
    expect(quotedResult?.added).toEqual([]);
    expect(quotedResult?.text).toBe(dstQuoted);
    // dst unquoted, src quoted
    const dstUnquoted = dstYaml("^\\s*git\\s+stash");
    const unquotedResult = mergeInterceptorPatterns(SRC_STASH_QUOTED, dstUnquoted);
    expect(unquotedResult?.added).toEqual([]);
    expect(unquotedResult?.text).toBe(dstUnquoted);
  });

  test("returns null when dst has no patterns list", () => {
    expect(mergeInterceptorPatterns(SRC_YAML, "theme: tundra\n")).toBeNull();
    expect(mergeInterceptorPatterns(SRC_YAML, "bashInterceptor:\n  enabled: true\n")).toBeNull();
    expect(
      mergeInterceptorPatterns(SRC_YAML, "bashInterceptor:\n  patterns:\n  enabled: true\n"),
    ).toBeNull();
  });

  test("output always keeps a trailing newline, even when dst lacks one", () => {
    const dstNoNewline = dstYaml("^\\s*cat\\s+").replace(/\n$/, "");
    const result = mergeInterceptorPatterns(SRC_YAML, dstNoNewline);
    expect(result?.text.endsWith("\n")).toBe(true);
    expect(result?.text.startsWith("theme: tundra\n")).toBe(true);
    expect(result?.text.endsWith("astGrep:\n  enabled: true\n")).toBe(true);
  });

  test("double-quoted dst scalar with escaped backslashes matches unquoted src", () => {
    // dst stores the same regex as a double-quoted YAML scalar: "^\\s*git\\s+stash"
    const dst = dstYaml('"^\\\\s*git\\\\s+stash"');
    const result = mergeInterceptorPatterns(SRC_YAML, dst);
    expect(result?.added).toEqual(["^\\s*git\\s+push"]);
    expect(result?.text).not.toContain("git\\s+stash\\n      tool: ask\n    - pattern");
  });

  test("does not corrupt an unrelated patterns section when bashInterceptor has none", () => {
    const dst = [
      "bashInterceptor:",
      "  enabled: true",
      "weirdSection:",
      "  patterns:",
      "    - pattern: foreign\\d+",
      "      tool: hub",
      "",
    ].join("\n");
    expect(mergeInterceptorPatterns(SRC_YAML, dst)).toBeNull();
  });
});
describe("fix regressions at runInstall level", () => {
  test("--no-plugin reconcile retains the plugin-package dir entry in the manifest", async () => {
    const t = tempDir("p1-no-plugin-");
    mkdirSync(join(t, ".omp", "profiles", "minimax", "agent"), { recursive: true });
    const rel = ".omp/plugins/node_modules/oh-my-pi-integration";
    const argvFor = (...extra: string[]) => ["--target", t, ...extra];
    await runInstall(argvFor());
    const manifestPath = join(t, ".omp", "plugins", "oh-my-pi-integration.manifest");
    expect(readFileSync(manifestPath, "utf8")).toContain(`D - ${rel}`);
    await runInstall([...argvFor(), "--no-plugin"]);
    const after = readFileSync(manifestPath, "utf8");
    expect(after).toContain(`D - ${rel}`);
    expect(existsSync(join(t, rel))).toBe(true);
  });

  test("merge refuses a symlinked user-modified config and leaves the victim untouched", async () => {
    const t = tempDir("p2b-symlink-");
    const victim = tempDir("p2b-victim-");
    mkdirSync(join(t, ".omp", "profiles", "minimax", "agent"), { recursive: true });
    await runInstall(["--target", t]);
    const cfg = join(t, ".omp", "agent", "config.yml");
    const personal = readFileSync(cfg, "utf8").replace(
      "symbolPreset: nerd",
      "symbolPreset: p2b-test-persona",
    );
    const victimCfg = join(victim, "victim.yml");
    writeFileSync(victimCfg, personal);
    rmSync(cfg);
    symlinkSync(victimCfg, cfg);
    await runInstall(["--target", t]);
    // dst must still be the symlink and the victim must not gain patterns
    expect(readlinkSync(cfg)).toBe(victimCfg);
    const victimText = readFileSync(victimCfg, "utf8");
    expect(victimText).toBe(personal);
  });
  test("install bootstraps a profile dir from repo source instead of failing", async () => {
    const t = tempDir("p0-bootstrap-");
    const rc = await runInstall(["--target", t]);
    expect(rc).toBe(0);
    const profileAgent = join(t, ".omp", "profiles", "minimax", "agent");
    expect(statSync(profileAgent).isDirectory()).toBe(true);
    expect(readFileSync(join(profileAgent, "config.yml"), "utf8")).toMatch(/setupVersion: 2/);
    expect(readFileSync(join(profileAgent, "AGENTS.md"), "utf8").length).toBeGreaterThan(100);
  });

  test("ships the receipt extension and symlinks the profile AGENTS.md", async () => {
    const t = tempDir("p0-receipt-");
    expect(await runInstall(["--target", t])).toBe(0);
    expect(existsSync(join(t, ".omp", "agent", "extensions", "receipt", "receipt.ts"))).toBe(true);
    const link = join(t, ".omp", "profiles", "minimax", "agent", "AGENTS.md");
    expect(readlinkSync(link)).toBe("../../../agent/AGENTS.md");
    expect(readFileSync(link, "utf8")).toBe(
      readFileSync(join(t, ".omp", "agent", "AGENTS.md"), "utf8"),
    );
  });
  test("ships APPEND_SYSTEM.md and symlinks it into profiles", async () => {
    const t = tempDir("p0-append-");
    expect(await runInstall(["--target", t])).toBe(0);
    const canonical = readFileSync(join(t, ".omp", "agent", "APPEND_SYSTEM.md"), "utf8");
    expect(canonical.trim().length).toBeGreaterThan(0);
    expect(canonical).toContain("ctx_patch");
    const link = join(t, ".omp", "profiles", "minimax", "agent", "APPEND_SYSTEM.md");
    expect(readlinkSync(link)).toBe("../../../agent/APPEND_SYSTEM.md");
    expect(readFileSync(link, "utf8")).toBe(canonical);
  });

  test("keeps a diverged profile APPEND_SYSTEM.md and swaps it only under --force", async () => {
    const t = tempDir("p0-append-diverge-");
    await runInstall(["--target", t]);
    const link = join(t, ".omp", "profiles", "minimax", "agent", "APPEND_SYSTEM.md");
    rmSync(link);
    writeFileSync(link, "custom profile append\n");
    await runInstall(["--target", t]);
    expect(readFileSync(link, "utf8")).toBe("custom profile append\n");
    await runInstall(["--target", t, "--force"]);
    expect(readFileSync(link, "utf8")).toContain("ctx_patch");
    expect(readFileSync(`${link}.bak`, "utf8")).toBe("custom profile append\n");
  });

  test("keeps a diverged profile AGENTS.md and swaps it only under --force", async () => {
    const t = tempDir("p0-agents-diverge-");
    await runInstall(["--target", t]);
    const link = join(t, ".omp", "profiles", "minimax", "agent", "AGENTS.md");
    rmSync(link);
    writeFileSync(link, "custom profile rules\n");
    await runInstall(["--target", t]);
    expect(readFileSync(link, "utf8")).toBe("custom profile rules\n");
    await runInstall(["--target", t, "--force"]);
    expect(readFileSync(link, "utf8")).toContain("Global Agent Instructions");
    expect(readFileSync(`${link}.bak`, "utf8")).toBe("custom profile rules\n");
  });

  test("refuses --target under a system path and exits 3 without writing", async () => {
    const rc = await runInstall(["--target", "/etc/omp-test"]);
    expect(rc).toBe(3);
    expect(existsSync("/etc/omp-test")).toBe(false);
  });

  test("refuses --target under another user's /home and exits 3", async () => {
    const rc = await runInstall(["--target", "/home/somebodyelse/omp-test"]);
    expect(rc).toBe(3);
    expect(existsSync("/home/somebodyelse/omp-test")).toBe(false);
  });

  test("refuses --target=/ (filesystem root) and exits 3", async () => {
    const rc = await runInstall(["--target", "/"]);
    expect(rc).toBe(3);
  });
});

// ---- parseArgs -------------------------------------------------------------

describe("parseArgs", () => {
  test("defaults per install.sh header", () => {
    expect(parseArgs([], {})).toEqual({
      target: "/tmp/omp-test",
      force: false,
      dryRun: false,
      noPlugin: false,
      cleanBak: false,
      live: false,
      help: false,
    });
  });

  test("PREFIX env sets the default target; --target overrides it", () => {
    expect(parseArgs([], { PREFIX: "/opt/omp" }).target).toBe("/opt/omp");
    expect(parseArgs(["--target", "/tmp/x"], { PREFIX: "/opt/omp" }).target).toBe("/tmp/x");
    expect(parseArgs([], { PREFIX: "" }).target).toBe("/tmp/omp-test");
  });

  test("parses all flags in any order", () => {
    const flags = parseArgs(
      ["--dry-run", "--force", "--target", "/tmp/z", "--no-plugin", "--clean-bak", "--live"],
      {},
    );
    expect(flags).toEqual({
      target: "/tmp/z",
      force: true,
      dryRun: true,
      noPlugin: true,
      cleanBak: true,
      live: true,
      help: false,
    });
  });

  test("-h and --help set the help flag", () => {
    expect(parseArgs(["-h"], {}).help).toBe(true);
    expect(parseArgs(["--help"], {}).help).toBe(true);
  });

  test("unknown options raise exit code 2", () => {
    let err: unknown;
    try {
      parseArgs(["--bogus"], {});
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(InstallerError);
    const installerErr = err as InstallerError;
    expect(installerErr.exitCode).toBe(2);
    expect(installerErr.message).toBe("unknown option: --bogus");
  });

  test("--target without a path raises exit code 1", () => {
    for (const argv of [["--target"], ["--target", ""]]) {
      let err: unknown;
      try {
        parseArgs(argv, {});
      } catch (caught) {
        err = caught;
      }
      expect(err).toBeInstanceOf(InstallerError);
      expect((err as InstallerError).exitCode).toBe(1);
      expect((err as InstallerError).message).toBe("--target requires a path");
    }
  });
});

// ---- fileSha / realpathMissing --------------------------------------------

describe("fileSha", () => {
  test("hashes regular files", async () => {
    const dir = tempDir("installer-sha-");
    const file = join(dir, "f.txt");
    writeFileSync(file, "hello\n");
    expect(await fileSha(file)).toBe(
      "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
    );
  });

  test("returns empty for missing files, directories, and symlinks", async () => {
    const dir = tempDir("installer-sha-miss-");
    const file = join(dir, "f.txt");
    writeFileSync(file, "x");
    symlinkSync(file, join(dir, "link"));
    expect(await fileSha(join(dir, "missing"))).toBe("");
    expect(await fileSha(dir)).toBe("");
    expect(await fileSha(join(dir, "link"))).toBe("");
  });
});

describe("realpathMissing", () => {
  test("canonicalizes paths with missing components lexically", () => {
    const dir = tempDir("installer-rp-");
    expect(realpathMissing(join(dir, "nope", "deeper"))).toBe(join(dir, "nope", "deeper"));
  });

  test("resolves symlinked components", () => {
    const dir = tempDir("installer-rp-link-");
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    expect(realpathMissing(join(dir, "link", "child"))).toBe(join(dir, "real", "child"));
  });
});

// ---- profile config fragments ---------------------------------------------

describe("assembleProfileConfig (fragment deep-merge)", () => {
  test("fragment scalars override, maps merge recursively, lists replace", () => {
    const base = [
      "theme:",
      "  dark: base-dark",
      "  light: base-light",
      "providers:",
      "  maxInFlightRequests:",
      "    anthropic: 1",
      "    zai: 5",
      "bashInterceptor:",
      "  patterns:",
      "    - pattern: ^a",
      "      tool: read",
      "compaction:",
      "  thresholdTokens: 200000",
    ].join("\n");
    const frag = [
      "theme:",
      "  dark: frag-dark",
      "providers:",
      "  maxInFlightRequests:",
      "    zai: 20",
      "bashInterceptor:",
      "  patterns:",
      "    - pattern: ^b",
      "      tool: grep",
    ].join("\n");
    const merged = parseYaml(assembleProfileConfig(base, frag));
    expect(merged.theme).toEqual({ dark: "frag-dark", light: "base-light" });
    expect(merged.providers.maxInFlightRequests).toEqual({ anthropic: 1, zai: 20 });
    expect(merged.bashInterceptor.patterns).toEqual([{ pattern: "^b", tool: "grep" }]);
    expect(merged.compaction.thresholdTokens).toBe(200000);
  });

  test("empty fragment or empty base degrades to the other side", () => {
    expect(parseYaml(assembleProfileConfig("a: 1\n", ""))).toEqual({ a: 1 });
    expect(parseYaml(assembleProfileConfig("", "a: 1\n"))).toEqual({ a: 1 });
  });

  test("invalid fragment YAML raises InstallerError with exit code 1", () => {
    expect(() => assembleProfileConfig("a: 1\n", "b: [1, 2\n")).toThrow(InstallerError);
  });

  test("long interceptor regex lines stay unwrapped", () => {
    const regex = `^\\s*git\\s+stash\\b(?![\\s\\S]*\\s--\\s+\\S)${"x".repeat(120)}`;
    const text = assembleProfileConfig(
      `bashInterceptor:\n  patterns:\n    - pattern: ${JSON.stringify(regex)}\n      tool: ask\n`,
      "theme:\n  dark: d\n",
    );
    expect(text).not.toContain("\n      x"); // never folded onto a continuation line
    expect(parseYaml(text).bashInterceptor.patterns[0].pattern).toBe(regex);
  });
});

describe("profile fragments (runInstall)", () => {
  test("assembles fragment profiles over the base config and lands runtime symlinks", async () => {
    const t = tempDir("installer-frag-");
    const rc = await runInstall(["--target", t]);
    expect(rc).toBe(0);

    const glm = parseYaml(
      readFileSync(join(t, ".omp", "profiles", "glm", "agent", "config.yml"), "utf8"),
    );
    expect(glm.modelRoles.default).toBe("zai/glm-5.3");
    expect(glm.providers.maxInFlightRequests.zai).toBe(20);
    expect(glm.providers.maxInFlightRequests.anthropic).toBe(1); // base key survives the union
    expect(glm.compaction).toEqual({ thresholdPercent: 75, thresholdTokens: 300000 });
    expect(glm.bashInterceptor.enabled).toBe(true); // inherited from base, not shipped per profile
    expect(glm.memory.backend).toBe("mnemopi");

    const mm = parseYaml(
      readFileSync(join(t, ".omp", "profiles", "minimax", "agent", "config.yml"), "utf8"),
    );
    expect(mm.modelRoles.default).toBe("minimax-code/MiniMax-M3");
    expect(mm.compaction.thresholdTokens).toBe(200000);
    expect(mm.bashInterceptor.enabled).toBe(true);

    expect(readlinkSync(join(t, ".omp", "profiles", "glm", "agent", "rules"))).toBe(
      "../../../agent/rules",
    );
  });
});

describe("--clean-bak (stale backup sweep)", () => {
  async function parkBak(target: string): Promise<string> {
    await runInstall(["--target", target]);
    const cfg = join(target, ".omp", "agent", "config.yml");
    writeFileSync(cfg, "mutated: true\n");
    await runInstall(["--target", target, "--force"]);
    return `${cfg}.bak`;
  }

  test("removes installer-owned .bak parks, keeps untracked strays", async () => {
    const t = tempDir("installer-clean-bak-");
    const bak = await parkBak(t);
    expect(existsSync(bak)).toBe(true);
    const stray = join(t, ".omp", "stray.yml.bak");
    writeFileSync(stray, "user data\n");

    const rc = await runInstall(["--target", t, "--clean-bak"]);
    expect(rc).toBe(0);
    expect(existsSync(bak)).toBe(false);
    expect(existsSync(stray)).toBe(true);
  });

  test("dry-run reports the sweep without deleting", async () => {
    const t = tempDir("installer-clean-bak-dry-");
    const bak = await parkBak(t);
    const rc = await runInstall(["--target", t, "--clean-bak", "--dry-run"]);
    expect(rc).toBe(0);
    expect(existsSync(bak)).toBe(true);
  });

  test("no-op run without the flag leaves backups in place", async () => {
    const t = tempDir("installer-clean-bak-off-");
    const bak = await parkBak(t);
    await runInstall(["--target", t]);
    expect(existsSync(bak)).toBe(true);
  });
});
