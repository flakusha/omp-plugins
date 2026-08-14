---
name: loop-lore-world-timeline
description: "Implement world timeline backstory seeding in loop-lore: table, service, applyEvents hook, tests, gates"
---

# Loop-Lore World Timeline (Backstory Seeding)

Use when implementing the world timeline cluster (`docs/spec/lore.md` §5) in loop-lore.

## Facts
- `world_timeline_events` table: migration `src/db/migrations/030_world_timeline_events.ts`, interface in `src/db/schema-core.ts`, wired in `src/db/schema.ts`.
- Columns: id (PK), world_id (FK→worlds cascade), story_id (nullable TEXT, **NO FK ref** — there is no `stories` table; an FK ref makes the migration fail `no such table: main.stories`), event_type, actor_id, description, data, occurred_at (ISO text), created_at.
- After adding the table, run `bun run db:sync-manifest` (regenerates manifest) and bump the table-count assertion in `src/db/schema-sync.test.ts` (was 96→97).

## Service (`src/story/timeline/world-timeline.ts`)
- Imports: `randomUUID` from node:crypto; `serializeOrThrow` from `../shared/story-utils` (returns string, throws on failure). `promoteEventToLore` from `../events/promote-lore` reads `audienceScope` from `event.data.audienceScope` — NOT a 4th arg.
- `appendTimelineEvents({db,worldId,storyId,events})` — one row per event, `occurred_at` = event.timestamp.
- `seedBackstory({db,worldId,description,occurredAt,...})` — returns UUID; optional `audienceScope` promotes to a `world_lore_entries` row by building a synthetic WorldEvent with `data: { ...data, audienceScope }`.
- `listTimelineEntries` / `getEstablishedHistory({since})` — `since` maps to `occurredBefore`.
- Barrel: `src/story/timeline/index.ts` exports functions + types.

## applyEvents hook (`src/story/events/application.ts`)
- `ApplyEventsOpts` gains `storyId?: string | null`.
- After the loop, collect applied results in a **for-of + push** (`.filter()`/`.map()` are banned by eslint `no-restricted-syntax`), then call `appendTimelineEvents`.

## Tests (`src/story/timeline/world-timeline.test.ts`)
- Use `createTestDb()` + `insertUsers`/`insertWorlds`; read ids back via selectFrom (insert helpers don't return them). `ensureLogger()` at test start.
- To genuinely exercise the failed-event exclusion in applyEvents, cast a bogus type: `{ ...makeEvent(), type: "bogus" as WorldEventType }` → hits `assertNever` → `applied: false`, nothing persisted.

## Gates
- `bun run typecheck`, `bunx eslint <edited files>`, `bunx dprint fmt` then `dprint check`, `bunx markdownlint-cli2` on edited docs, `bun test src/story/timeline/ src/story/events/`.
