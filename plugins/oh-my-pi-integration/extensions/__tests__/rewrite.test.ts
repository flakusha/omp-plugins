import { describe, expect, test } from "bun:test";
import { isSimpleCommand, parseRtkSubcommands, rewriteCommand, routeRtk } from "../index";

/** Representative `rtk --help` Commands block (subcommands vs. flags). */
const RTK_HELP = `A high-performance CLI proxy designed to filter and summarize system outputs.

Usage: rtk [OPTIONS] <COMMAND>

Commands:
  ls             List directory contents with token-optimized output
  read           Read file with intelligent filtering
  git            Git commands with compact output
  -h, --help     Print help
  --version      Print version

Options:
  -r, --raw      Bypass filtering
  -v, --verbose  Increase verbosity
`;

describe("parseRtkSubcommands", () => {
  test("extracts subcommand names from the Commands block", () => {
    const names = parseRtkSubcommands(RTK_HELP);
    expect(names.has("ls")).toBe(true);
    expect(names.has("read")).toBe(true);
    expect(names.has("git")).toBe(true);
  });

  test("ignores flags and option lines", () => {
    const names = parseRtkSubcommands(RTK_HELP);
    expect(names.has("-h")).toBe(false);
    expect(names.has("--help")).toBe(false);
    expect(names.has("--version")).toBe(false);
    expect(names.has("--raw")).toBe(false);
    expect(names.has("--verbose")).toBe(false);
  });

  test("empty input yields an empty set", () => {
    expect(parseRtkSubcommands("").size).toBe(0);
  });
});

describe("routeRtk", () => {
  const discovered = new Set(["ls", "read", "git", "json", "deps"]);

  test("routes a safe subcommand present in the installed rtk", () => {
    expect(routeRtk("git", discovered, true)).toBe(true);
    expect(routeRtk("ls", discovered, true)).toBe(true);
  });

  test("refuses when rtk is not installed/discoverable", () => {
    expect(routeRtk("git", discovered, false)).toBe(false);
  });

  test("refuses a safe subcommand missing from the installed rtk (version drift)", () => {
    expect(routeRtk("wc", discovered, true)).toBe(false); // not in discovered
    expect(routeRtk("psql", discovered, true)).toBe(false);
  });

  test("trusts the curated set when rtk is present but unenumerable", () => {
    expect(routeRtk("git", new Set(), true)).toBe(true);
    expect(routeRtk("wc", new Set(), true)).toBe(true);
  });

  test("never routes a subcommand outside the curated safe set", () => {
    expect(routeRtk("vim", discovered, true)).toBe(false);
    expect(routeRtk("rm", discovered, true)).toBe(false);
  });
});

describe("isSimpleCommand", () => {
  test("accepts single commands with plain args", () => {
    expect(isSimpleCommand("git status")).toBe(true);
    expect(isSimpleCommand("pwd")).toBe(true);
    expect(isSimpleCommand("ls -la src")).toBe(true);
    expect(isSimpleCommand("echo 'a b'")).toBe(true);
  });

  test("rejects shell metacharacters / separators", () => {
    expect(isSimpleCommand("git status | head")).toBe(false);
    expect(isSimpleCommand("a && b")).toBe(false);
    expect(isSimpleCommand("a; b")).toBe(false);
    expect(isSimpleCommand("a > out")).toBe(false);
    expect(isSimpleCommand("echo $HOME")).toBe(false);
  });

  test("rejects argv0 wrappers and whitespace groups", () => {
    expect(isSimpleCommand("sudo ls")).toBe(false);
    expect(isSimpleCommand("env FOO=1 ls")).toBe(false);
    expect(isSimpleCommand(" ls")).toBe(false);
    expect(isSimpleCommand("ls ")).toBe(false);
    expect(isSimpleCommand("")).toBe(false);
  });
});

describe("rewriteCommand (guard paths only — no discovery side effects)", () => {
  test("never rewrites PTY calls", () => {
    expect(rewriteCommand("git status", true, undefined)).toBe("git status");
  });

  test("never rewrites async/background calls", () => {
    expect(rewriteCommand("git status", undefined, true)).toBe("git status");
  });

  test("never rewrites non-simple commands", () => {
    expect(rewriteCommand("git status | head", undefined, undefined)).toBe("git status | head");
  });
});
