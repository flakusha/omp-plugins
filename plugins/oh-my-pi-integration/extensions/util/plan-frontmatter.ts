/**
 * Label extraction for `.plan/*.md` tickets and epics — harmonizes the three
 * authoring conventions in use (see INFRA-find-work-read-plan-frontmatter-labels
 * and loop-lore's unified-spec-framework §5.1):
 *
 * 1. YAML frontmatter `labels:` (flow `[a, b]`, bare `labels: bug`, or block
 *    `- a` list) — wins when present (explicit > inherited)
 * 2. header `**Labels:** a, b` — the 343+-file corpus convention
 * 3. header `**Tags:** a, b` — alias kept for 2 epic outliers
 *
 * Intentionally no YAML dependency: the supported subset is exactly the one
 * the corpus and the unified spec use. Values are comma/list-split, trimmed,
 * and unquoted; the first source yielding a non-empty list wins.
 */

const FENCE_RE = /^---\s*$/;
const LABELS_KEY_RE = /^labels:\s*(.*)$/;
const FLOW_LIST_RE = /^\[(.*)\]\s*$/;
const BLOCK_ITEM_RE = /^\s+-\s+(.+)$/;
/** `**Labels:** a, b` / `Tags: a, b` — bold and casing optional, per corpus
 * (colon inside or outside the bold on either side). */
const LABELS_HEADER_RE =
  /^\s*(?:[-*>]\s*)?(?:\*\*)?\s*(labels|tags)\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/i;

/** Strip one symmetric quote pair (`"a"` / `'a'` → `a`). */
function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => unquote(value.trim()))
    .filter(Boolean);
}

function flowOrBare(rest: string): string[] {
  const flow = FLOW_LIST_RE.exec(rest);
  return splitList(flow ? (flow[1] ?? "") : rest);
}

/** Labels from a leading `---` frontmatter block, or [] when none. */
function frontmatterLabels(lines: string[]): string[] {
  if (!FENCE_RE.test(lines[0] ?? "")) return [];
  const block: string[] = [];
  let inLabels = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE_RE.test(line)) break;
    if (inLabels) {
      const item = BLOCK_ITEM_RE.exec(line);
      if (!item) break; // any non-list line ends the labels block
      block.push(unquote(item[1] ?? "").trim());
      continue;
    }
    const key = LABELS_KEY_RE.exec(line);
    if (!key) continue;
    const rest = (key[1] ?? "").trim();
    if (!rest || rest === "|" || rest === ">") {
      inLabels = true; // block form: collect following `- item` lines
      continue;
    }
    return flowOrBare(rest);
  }
  return block.filter(Boolean);
}

/** Header labels below any frontmatter fence: Labels beats Tags regardless of order. */
function headerLabels(lines: string[]): string[] {
  let tags: string[] | null = null;
  for (const line of lines) {
    const header = LABELS_HEADER_RE.exec(line);
    if (!header) continue;
    const values = splitList(header[2] ?? "");
    if (values.length === 0) continue;
    if ((header[1] ?? "").toLowerCase() === "labels") return values;
    tags ??= values; // remember Tags but keep scanning: Labels outranks it
  }
  return tags ?? [];
}

/** Index after the closing frontmatter fence (whole file when unfenced). */
function afterFrontmatter(lines: string[]): number {
  if (!FENCE_RE.test(lines[0] ?? "")) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i] ?? "")) return i + 1;
  }
  return lines.length;
}

/**
 * Resolve one `.plan/*.md` document's labels: frontmatter `labels:`, else
 * header `**Labels:**`, else header `**Tags:**` (alias). [] when the file
 * declares none.
 */
export function readPlanLabels(text: string): string[] {
  const lines = text.split("\n");
  const frontmatter = frontmatterLabels(lines);
  if (frontmatter.length > 0) return frontmatter;
  // Scan starts after the fence so the frontmatter's own `labels:` key is
  // never re-read as a header.
  return headerLabels(lines.slice(afterFrontmatter(lines)));
}
