import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
});

// ---- parseArgs -------------------------------------------------------------

describe("parseArgs", () => {
  test("defaults per install.sh header", () => {
    expect(parseArgs([], {})).toEqual({
      target: "/tmp/omp-test",
      force: false,
      dryRun: false,
      noPlugin: false,
      live: false,
      ignoreUnbootstrappedProfiles: false,
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
      [
        "--dry-run",
        "--force",
        "--target",
        "/tmp/z",
        "--no-plugin",
        "--live",
        "--ignore-unbootstrapped-profiles",
      ],
      {},
    );
    expect(flags).toEqual({
      target: "/tmp/z",
      force: true,
      dryRun: true,
      noPlugin: true,
      live: true,
      ignoreUnbootstrappedProfiles: true,
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
