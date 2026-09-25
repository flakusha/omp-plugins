/**
 * `/find-work` `-s` search extension: tiered search over the fetched roster.
 *
 * Tier 1 — direct hits: exact tag match, exact id match, or the whole query
 * appearing as a phrase in the title.
 * Tier 2 — fuzzy candidates: every query token found as a substring of some
 * word in id+title+tags; scored by how much of the matched word the token
 * covers (closer to an exact word hit = better).
 * Tier 3 — potential connections of tier-1/2 seeds, per the .plan format
 * spec: the `**Epic:**` binding (sibling tickets + the epic item itself),
 * bare-text `TASK-*` refs inside the seed's epic file (giwt check-links
 * convention), and shared tags.
 *
 * Results are deduped by ticket id (best tier, then best score) and sorted
 * (tier, score, id) so callers can append them after the main roster.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePlanDir } from "../../util/giwt-config";
import { SEARCH_MAX_TICKETS } from "./keywords";
import type { WorkTicket } from "./types";

export interface SearchHit {
  ticket: WorkTicket;
  /** 1 = direct hit, 2 = fuzzy candidate, 3 = potential connection. */
  tier: 1 | 2 | 3;
  /** Lower is better; 0 for the best direct hits. */
  score: number;
  /** Match provenance shown in the roster (`tag:perf`, `fuzzy`, `epic:X`). */
  via: string;
}

/** Bare-text `TASK-<slug>` refs inside .plan epic files (giwt convention). */
const TASK_REF_RE = /\b(TASK-[A-Za-z0-9][A-Za-z0-9-]*)/g;

/** Normalize an epic binding/id for comparison (`epic-auth.md` ≡ `EPIC-auth`). */
function epicKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/^epic-/, "");
}

/**
 * Bare-text TASK refs per epic file stem (`epic-auth` → {TASK-a, TASK-b}),
 * read from `<epicsDir>/*.md` (8 KiB cap per file). Empty map on any fs
 * error — ref connections are best-effort enrichment, never a failure.
 */
export function epicRefIndex(epicsDir: string): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  let files: string[];
  try {
    files = readdirSync(epicsDir);
  } catch {
    return index;
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue;
    let text: string;
    try {
      text = readFileSync(join(epicsDir, file), "utf8").slice(0, 8192);
    } catch {
      continue;
    }
    const refs = new Set<string>();
    for (const m of text.matchAll(TASK_REF_RE)) {
      const ref = m[1];
      if (ref) refs.add(ref);
    }
    if (refs.size > 0) index.set(file.replace(/\.md$/, ""), refs);
  }
  return index;
}

/** Best coverage of `token` across candidate words: 1 = exact word, 0 = none. */
function tokenQuality(token: string, words: string[]): number {
  let best = 0;
  for (const word of words) {
    if (!word.includes(token)) continue;
    if (word === token) return 1;
    best = Math.max(best, token.length / word.length);
  }
  return best;
}

/** Tier-1 direct hits: exact id, title phrase, or whole-token tag match. */
function collectDirectHits(
  tickets: WorkTicket[],
  ql: string,
  tokens: string[],
  offer: (h: SearchHit) => void,
): void {
  for (const t of tickets) {
    if (t.id.toLowerCase() === ql) offer({ ticket: t, tier: 1, score: 0, via: "id" });
    if (t.title.toLowerCase().includes(ql))
      offer({ ticket: t, tier: 1, score: 0.25, via: "phrase" });
    for (const tag of t.tags ?? []) {
      if (tokens.includes(tag.toLowerCase())) {
        offer({ ticket: t, tier: 1, score: 0.1, via: `tag:${tag}` });
      }
    }
  }
}

/** Lower-cased token-split words from id+title+tags, used for fuzzy tier-2 scoring. */
function ticketWords(t: WorkTicket): string[] {
  return `${t.id} ${t.title} ${(t.tags ?? []).join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/** Tier-2 fuzzy candidates: every token must land somewhere (>= tier-1 already-wins short-circuit). */
function collectFuzzyHits(
  tickets: WorkTicket[],
  tokens: string[],
  hits: Map<string, SearchHit>,
  offer: (h: SearchHit) => void,
): void {
  for (const t of tickets) {
    const prev = hits.get(t.id);
    if (prev && prev.tier === 1) continue;
    const words = ticketWords(t);
    const qualities = tokens.map((tok) => tokenQuality(tok, words));
    if (!qualities.every((v) => v > 0)) continue;
    const avg = qualities.reduce((a, b) => a + b, 0) / qualities.length;
    offer({ ticket: t, tier: 2, score: 1 - avg, via: "fuzzy" });
  }
}

/** Epic binding: target and seed share an epic, or target IS an item in seed's epic. */
function seedConnectionVia(target: WorkTicket, seed: WorkTicket): string | undefined {
  if (target.id === seed.id) return undefined;
  if (seed.epic && target.epic && epicKey(seed.epic) === epicKey(target.epic)) {
    return `epic:${seed.epic}`;
  }
  if (seed.epic && target.kind === "epic" && epicKey(target.id) === epicKey(seed.epic)) {
    return `epic-item:${target.id}`;
  }
  return undefined;
}

/** Case-insensitive shared-tag lookup between target and seed. */
function sharedTag(target: WorkTicket, seed: WorkTicket): string | undefined {
  const targetTags = target.tags ?? [];
  const seedTags = seed.tags ?? [];
  for (const tag of targetTags) {
    const lower = tag.toLowerCase();
    if (seedTags.some((s) => s.toLowerCase() === lower)) return tag;
  }
  return undefined;
}

/** Pick the strongest connection via-label for `target` against any seed, or undefined. */
function connectionVia(
  target: WorkTicket,
  seeds: WorkTicket[],
  seedEpics: Map<string, string>,
  epicRefs: Map<string, Set<string>> | undefined,
): string | undefined {
  for (const seed of seeds) {
    const epic = seedConnectionVia(target, seed);
    if (epic) return epic;
    const tag = sharedTag(target, seed);
    if (tag) return `tag:${tag}`;
  }
  if (epicRefs) {
    for (const [epicFile, refIds] of epicRefs) {
      if (seedEpics.has(epicKey(epicFile)) && refIds.has(target.id)) {
        return `ref:${epicFile}`;
      }
    }
  }
  return undefined;
}

/** Tier-3 potential connections seeded by tier-1/2 hits (epic bindings, shared tags, file refs). */
function collectConnectionHits(
  tickets: WorkTicket[],
  hits: Map<string, SearchHit>,
  offer: (h: SearchHit) => void,
  root: string,
  epicsDir: string | undefined,
): void {
  const seeds = [...hits.values()].map((h) => h.ticket);
  if (seeds.length === 0) return;
  const seedEpics = new Map<string, string>(); // epicKey → display value
  for (const seed of seeds) if (seed.epic) seedEpics.set(epicKey(seed.epic), seed.epic);
  const epicRefs =
    seedEpics.size > 0 ? epicRefIndex(epicsDir ?? resolvePlanDir(root, "epics")) : undefined;
  for (const t of tickets) {
    if (hits.has(t.id)) continue;
    const via = connectionVia(t, seeds, seedEpics, epicRefs);
    if (via) offer({ ticket: t, tier: 3, score: 0.5, via });
  }
}

/**
 * Tiered `-s` search over the roster. `epicsDir` defaults to the repo's
 * `.plan/epics` (via resolvePlanDir); tests inject a fixture dir. Pure fs
 * reads only — the search phase never spawns subprocesses or mutates state.
 */
export function searchTickets(
  tickets: WorkTicket[],
  root: string,
  query: string,
  opts?: { max?: number; epicsDir?: string },
): SearchHit[] {
  const max = opts?.max ?? SEARCH_MAX_TICKETS;
  const q = query.trim();
  if (!q || max <= 0) return [];
  const ql = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter(Boolean);

  const hits = new Map<string, SearchHit>();
  const offer = (hit: SearchHit): void => {
    const prev = hits.get(hit.ticket.id);
    if (!prev || hit.tier < prev.tier || (hit.tier === prev.tier && hit.score < prev.score)) {
      hits.set(hit.ticket.id, hit);
    }
  };

  collectDirectHits(tickets, ql, tokens, offer);
  collectFuzzyHits(tickets, tokens, hits, offer);
  collectConnectionHits(tickets, hits, offer, root, opts?.epicsDir);

  return [...hits.values()]
    .sort((a, b) => a.tier - b.tier || a.score - b.score || a.ticket.id.localeCompare(b.ticket.id))
    .slice(0, max);
}
