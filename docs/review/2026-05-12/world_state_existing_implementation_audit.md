# Story World Existing Implementation Audit

> Date: 2026-05-12
> Branch: `codex/feature/story-world-overhaul`

## Routes

- World CRUD lives in `backend/app/main.py`:
  - `GET /worlds`
  - `POST /worlds`
  - `GET /worlds/{world_id}`
  - `PATCH /worlds/{world_id}`
  - `DELETE /worlds/{world_id}`
- Character CRUD:
  - `POST /worlds/{world_id}/characters`
  - `GET /worlds/{world_id}/characters/{character_id}`
  - `PATCH /worlds/{world_id}/characters/{character_id}`
  - `DELETE /worlds/{world_id}/characters/{character_id}` soft-retiring the character.
- Memory CRUD:
  - `GET /worlds/{world_id}/characters/{character_id}/memories`
  - `POST /worlds/{world_id}/characters/{character_id}/memories`
  - `PATCH /worlds/{world_id}/characters/{character_id}/memories/{memory_id}`
  - `DELETE /worlds/{world_id}/characters/{character_id}/memories/{memory_id}`
- Relationship CRUD:
  - `GET /worlds/{world_id}/characters/{character_id}/relations`
  - `PUT/PATCH/DELETE /worlds/{world_id}/characters/{character_id}/relations/{target_character_id}`
- Scene routes:
  - `POST /worlds/{world_id}/scenes`
  - `GET /worlds/{world_id}/timeline`
  - `POST /rooms/{room_id}/scene/enter`
  - `POST /rooms/{room_id}/scene/exit`
  - `GET /rooms/{room_id}/scene/members`
  - `POST /rooms/{room_id}/seal`

## Data Models

- `World` stores root metadata: `name`, `synopsis`, `setting`, `calendar_hint`, cover fields, `status`, `config`, timestamps.
- `Room` doubles as Scene when `world_id IS NOT NULL`; scene fields are `world_id`, `scene_index`, `in_world_time_start`, `in_world_time_end`, `in_world_duration_hint`, `sealed_at`.
- `WorldCharacter` stores character profile: `kind`, `name`, `identity`, `brief`, persona binding, `core_identity`, `skills_text`, `goals_text`, visual fields, `status`, `config`.
- `WorldSceneMember` is the append-only roster interval model: one row per character per scene, with enter/exit message ids.
- `WorldCharacterMemory` stores episodic-like memory rows with `kind`, `source_scene_id`, `scene_index_at_write`, time label, salience, optional target character, and retrieval bookkeeping.
- `WorldCharacterRelation` stores directed relationship cards from one AI character to another character with `label`, scalar `sentiment`, accumulated `notes`, and `last_updated_scene_id`.
- There is no first-class `TimelineEvent`, `WorldBible`, `PlotHook`, `SealDraft`, or `SealCommit` table yet.
- Schema upgrades use `Base.metadata.create_all` plus `backend/app/db.py::_ADDED_COLUMNS`; new columns on existing tables must be added there.

## Components

- `frontend/src/pages/WorldListPage.tsx` lists worlds and creates a basic world with name, synopsis, calendar hint, and cover color.
- `frontend/src/pages/WorldDetailPage.tsx` currently renders a two-column detail page:
  - character list, batch add, character creation/editing.
  - scene list with create-scene form and sealed-scene output entry.
- `frontend/src/pages/world/SceneInspectorDialog.tsx` is a read-only post-seal inspector. It filters memory rows by `source_scene_id` and relation cards by `last_updated_scene_id`.
- `frontend/src/pages/room/RoomShell.tsx` exposes scene context, scene seal action, and the post-seal `SealResultsDialog`.
- Frontend API wrappers and React Query keys already exist for worlds, timeline, scene members, memories, and relations.

## LLM Flows

- Scene character prompts are composed through `backend/app/prompts.py::compose_scene_persona_prompt`.
- Scene creation snapshots each AI `WorldCharacter` into a `PersonaInstance` with world context, character profile, retrieved top-K memories, and same-scene relationship cards.
- Regular room scribe and facilitator skip Story World scenes unless forced.
- Current seal flow is synchronous and one-step:
  - `POST /rooms/{room_id}/seal`
  - drains active calls.
  - stamps `Room.sealed_at`.
  - calls `engine.run_scene_memory_scribe`.
  - writes `WorldCharacterMemory` rows and mutates `WorldCharacterRelation` rows.
  - runs memory decay/cap.
  - returns per-character scribe counts.
- Current seal idempotency is based on `Room.sealed_at` plus per-character `source_scene_id` duplicate checks.

## Persistence

- SQLite by default, optional PostgreSQL via `DATABASE_URL`.
- JSON fields use `models.JSONType`, with SQLite JSON and PostgreSQL JSONB.
- There is no Alembic. Existing-table column additions must be mirrored in `_ADDED_COLUMNS`.
- Built-ins are content in `backend/app/seed.py`; Story World runtime records are user data, not seeded content.

## Frontend State

- Server data uses TanStack Query.
- Streaming room state uses Zustand only for transient streaming buffers.
- World Detail currently depends on:
  - `queryKeys.world(worldId)`
  - `queryKeys.worldTimeline(worldId)`
  - `queryKeys.sceneMembers(sceneId)`
  - per-character memory/relation keys inside the inspector.
- User-facing strings are in `frontend/src/i18n.tsx` and must stay bilingual.

## Tests

- Existing backend coverage:
  - `test_worlds.py`: World/Character CRUD.
  - `test_scenes.py`: Scene creation, timeline order, enter/exit, seal idempotency/read-only rules.
  - `test_memory.py`: manual memory CRUD and prompt baking.
  - `test_memory_decay.py`: salience decay and memory cap.
  - `test_relations.py`: relation CRUD and prompt baking.
- Tests are designed to run from `backend/` and may use real LLM endpoints unless monkeypatched.

## Gaps

- World Detail is still mostly a character/scenes management page, not a world state console.
- Current timeline is a Scene list; it cannot show history events, memory events, relationship changes, plot hooks, or arc updates.
- World Bible is not first-class. Existing fields cover only `synopsis`, `setting`, and `calendar_hint`; richer data can be staged in `World.config` before adding tables.
- Character memory lacks P0 metadata such as `importance`, `confidence`, `status`, `locked`, and explicit source labels. Existing `salience`, `kind`, `source_scene_id`, and `scene_index_at_write` can provide a compatibility layer.
- Relationship cards are directed and readable but not yet visualized as a world-level graph/list.
- Seal is one-step and immediately mutates long-term state, which conflicts with the P0 requirement for `Seal Draft -> Inspector -> Commit`.
- Scene-end inspector is read-only and post-commit; it is not yet an editable pre-commit inspector.

## Reuse Plan

- Reuse `World.config` for P0.1/P0.2-compatible World Bible and mainline fields before adding more tables.
- Add a first-class `world_timeline_events` table for non-scene Timeline events while keeping existing Scene timeline entries compatible.
- Add relationship and memory world-level read endpoints so World Detail can render state without N+1 component-level queries.
- Keep `WorldCharacterMemory` and `WorldCharacterRelation` as the first P0.3 storage layer; expose source/scene/status labels in UI from existing fields.
- Treat the two-stage seal change as a compatibility-sensitive migration: introduce draft endpoints and a commit endpoint while preserving old data and avoiding duplicate committed writes.
