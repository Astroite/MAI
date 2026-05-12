# P0 World State Implementation Plan

> Date: 2026-05-12
> Scope: Minimum compatible implementation for the P0 World State System.

## Existing Reuse

- Keep `World`, `WorldCharacter`, `Room` as Scene, `WorldSceneMember`, `WorldCharacterMemory`, and `WorldCharacterRelation`.
- Keep Scene creation, roster, prompt baking, narration/act-as composer, and existing memory retrieval behavior intact.
- Use `World.config` as the first home for World Bible and current mainline fields:
  - `world_bible`
  - `current_arc`
  - `plot_hooks`
  - `next_scene_suggestions`
- Keep existing `GET /worlds/{id}/timeline` behavior available to older frontend code, but add richer state endpoints for the new World Detail console.

## New Data Structures

- Add `WorldTimelineEvent` table for first-class non-scene timeline entries and committed seal-derived state changes.
- Store event type, title, summary, date label, order, source, status, optional scene id, related character ids, related memory/relation ids, and timestamps.
- Add compatibility schemas for:
  - `WorldStateOut`
  - `WorldBibleOut` / `WorldBibleUpdate`
  - `WorldTimelineEventOut/Create/Update`
  - `WorldRelationshipEdgeOut`
  - `WorldMemoryOverviewOut`
- Defer new columns on `WorldCharacterMemory` and `WorldCharacterRelation`; P0.4 writes through `WorldSceneSealDraft` and existing committed tables, while P0.3 UI derives source/status labels from existing fields.

## UI Changes

- Rework `WorldDetailPage.tsx` into a world console:
  - header with current story time, main arc, current location, recent update, continue/open next scene actions.
  - status cards for recent scene, mainline conflict, unresolved hooks, active characters.
  - tabs: Overview, Timeline, World Bible, Characters, Relationships, Memories, Scenes.
- Timeline tab:
  - filter by type.
  - show history events from `WorldTimelineEvent`.
  - show Scene nodes from existing scene timeline.
  - stable ordering by `order` and scene index.
- World Bible tab:
  - edit summary/background/current time/current location/current arc/locations/factions/rules through `World.config` plus existing fields.
  - show source/locked-like metadata where present in config.
- Characters/Memories/Relationships tabs:
  - readable state panels using current character fields, memory rows, and relation cards.
  - list fallback for relationships instead of a force-directed-only graph.

## LLM Flow Changes

- P0.1-P0.3 do not change LLM behavior.
- P0.4 replaces the old one-step seal with a two-stage flow:
  - `POST /rooms/{room_id}/seal` and `POST /rooms/{room_id}/seal-drafts` generate an editable draft.
  - `GET/PATCH /rooms/{room_id}/seal-drafts/{draft_id}` powers the Inspector.
  - `POST /rooms/{room_id}/seal-drafts/{draft_id}/retry` generates a new retry draft.
  - `POST /rooms/{room_id}/seal-drafts/{draft_id}/commit` writes `Room.sealed_at`, timeline events, memories, relations, and memory maintenance.

## Migration Plan

- For the new timeline table:
  - fresh DB: `Base.metadata.create_all`.
  - old DB: table creation is covered by `create_all`, no `_ADDED_COLUMNS` needed.
- For future existing-table columns:
  - add SQLAlchemy field.
  - add dialect-specific DDL in `_ADDED_COLUMNS`.
- Migration/compat rules:
  - existing Scenes remain Timeline scene nodes.
  - existing memory rows are displayed as `source = migration/manual/seal_committed` derived from `source_scene_id`.
  - old relation rows are displayed as committed cards.
  - old worlds without `World.config.world_bible` get empty state defaults.

## Risks

- Seal semantics are now two-stage; docs and UI treat `POST /rooms/{room_id}/seal` as draft generation, not commit.
- `World.config` can grow loose JSON shape quickly. Keep helper normalizers centralized and document the expected shape.
- World Detail can become dense. Use tabs, compact cards, and empty states instead of dumping every object into the first viewport.
- Relation visualization must stay readable with many characters. Prefer list/matrix fallback first.
- Tests assert draft generation, editable selected items, commit idempotency, and commit-time memory / relationship writes.

## Execution Order

1. Add audit and this plan.
2. Add backend world state/timeline schemas, model, routes, and tests.
3. Rework World Detail shell and tabs against the new endpoints.
4. Add Bible editing, Timeline create/edit basics, memory overview, relationship overview.
5. Run backend targeted tests and frontend build.
6. Implement P0.4 two-stage Seal Draft / Inspector / Commit.
