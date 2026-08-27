import { describe, expect, test } from "bun:test";
import {
  isSimpleCommand,
  nativeToRtk,
  parseRtkSubcommands,
  rewriteCommand,
  routeRtk,
} from "../index";

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

describe("nativeToRtk — read-family bridge (cat/head/tail/less/more → rtk read)", () => {
  test("cat maps to rtk read", () => {
    expect(nativeToRtk("cat file.txt")).toBe("rtk read file.txt");
    expect(nativeToRtk("cat a.txt b.txt")).toBe("rtk read a.txt b.txt");
    expect(nativeToRtk("cat -n file.txt")).toBe("rtk read file.txt"); // -n stripped, rtk read shows lines by default with -n
    expect(nativeToRtk("cat -- file.txt")).toBe("rtk read -- file.txt"); // `--` end-of-options preserved
  });

  test("cat with show-special-chars flags returns undefined (rtk read does not support)", () => {
    expect(nativeToRtk("cat -A file.txt")).toBeUndefined();
    expect(nativeToRtk("cat -E file.txt")).toBeUndefined();
    expect(nativeToRtk("cat -T file.txt")).toBeUndefined();
    expect(nativeToRtk("cat -v file.txt")).toBeUndefined();
    expect(nativeToRtk("cat --show-all file.txt")).toBeUndefined();
  });

  test("head maps to rtk read with --max-lines", () => {
    expect(nativeToRtk("head file.txt")).toBe("rtk read file.txt");
    expect(nativeToRtk("head -n 5 file.txt")).toBe("rtk read --max-lines 5 file.txt");
    expect(nativeToRtk("head --lines 5 file.txt")).toBe("rtk read --max-lines 5 file.txt");
    expect(nativeToRtk("head -5 file.txt")).toBe("rtk read --max-lines 5 file.txt");
  });

  test("head -c (byte count) returns undefined (unsupported by rtk read)", () => {
    expect(nativeToRtk("head -c 100 file.txt")).toBeUndefined();
    expect(nativeToRtk("head --bytes 100 file.txt")).toBeUndefined();
  });

  test("tail maps to rtk read with --tail-lines", () => {
    expect(nativeToRtk("tail file.txt")).toBe("rtk read file.txt");
    expect(nativeToRtk("tail -n 5 file.txt")).toBe("rtk read --tail-lines 5 file.txt");
    expect(nativeToRtk("tail --lines 5 file.txt")).toBe("rtk read --tail-lines 5 file.txt");
    expect(nativeToRtk("tail -5 file.txt")).toBe("rtk read --tail-lines 5 file.txt");
  });

  test("tail -c returns undefined", () => {
    expect(nativeToRtk("tail -c 100 file.txt")).toBeUndefined();
  });

  test("less and more map to rtk read", () => {
    expect(nativeToRtk("less file.txt")).toBe("rtk read file.txt");
    expect(nativeToRtk("more file.txt")).toBe("rtk read file.txt");
    expect(nativeToRtk("less -N file.txt")).toBe("rtk read -n file.txt"); // -N → -n (line numbers)
  });

  test("unknown native binaries return undefined (no rewrite)", () => {
    expect(nativeToRtk("vim file.txt")).toBeUndefined();
    expect(nativeToRtk("git status")).toBeUndefined();
    expect(nativeToRtk("npm install")).toBeUndefined();
  });

  test("head/tail with --help/--version return undefined (info commands)", () => {
    expect(nativeToRtk("head --help")).toBeUndefined();
    expect(nativeToRtk("tail --version")).toBeUndefined();
  });
});

describe("rewriteCommand — native-to-rtk bridge integration", () => {
  test("cat file rewrites through nativeToRtk bridge (NOT lean-ctx)", () => {
    // The key behavioral guarantee: cat file.txt becomes `rtk read file.txt`,
    // not `lean-ctx -c "cat file.txt"`. This eliminates the nested-wrap
    // failure mode (`lean-ctx -c "lean-ctx -c \"cat …\""`) reported by the user.
    expect(rewriteCommand("cat file.txt", undefined, undefined)).toBe("rtk read file.txt");
  });

  test("head -n 5 file rewrites with --max-lines translation", () => {
    expect(rewriteCommand("head -n 5 file.txt", undefined, undefined)).toBe(
      "rtk read --max-lines 5 file.txt",
    );
  });

  test("tail -n 5 file rewrites with --tail-lines translation", () => {
    expect(rewriteCommand("tail -n 5 file.txt", undefined, undefined)).toBe(
      "rtk read --tail-lines 5 file.txt",
    );
  });

  test("less / more rewrite through the bridge", () => {
    expect(rewriteCommand("less file.txt", undefined, undefined)).toBe("rtk read file.txt");
    expect(rewriteCommand("more file.txt", undefined, undefined)).toBe("rtk read file.txt");
  });

  test("cat -A still falls through to upstream (rtk read cannot replicate)", () => {
    // When nativeToRtk returns undefined for cat -A, the upstream path runs.
    // routeRtk also rejects cat (not in RTK_SAFE_SUBCOMMANDS), so it falls to
    // lean-ctx -c wrapping on a lean-ctx-available machine, or unchanged on
    // a machine without lean-ctx. Either way, the output starts with `cat -A`,
    // which is the safe behavior.
    const out = rewriteCommand("cat -A file.txt", undefined, undefined);
    expect(out === "cat -A file.txt" || out.startsWith("lean-ctx -c ")).toBe(true);
  });

  test("non-read-family commands still go through routeRtk / lean-ctx paths", () => {
    // git status is already in RTK_SAFE_SUBCOMMANDS; routeRtk picks it up
    // before nativeToRtk is consulted (nativeToRtk returns undefined for git).
    const out = rewriteCommand("git status", undefined, undefined);
    // Either rtk-prefixed (when installed) or lean-ctx-wrapped, depending on
    // environment. Both are valid for git — the bridge is irrelevant.
    expect(out === "rtk git status" || out.startsWith("lean-ctx -c ")).toBe(true);
  });
});
