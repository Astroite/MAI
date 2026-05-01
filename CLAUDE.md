# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

MAI is a multi-model collaborative discussion platform. It is a single-process FastAPI backend (`backend/app`) plus a Vite + React + TypeScript frontend (`frontend/src`), backed by PostgreSQL. The product and technical design specs in `docs/` are authoritative for intent — read them before changing engine semantics.

## Common commands

Backend (run from `backend/` with the `.venv` activated):

- Install: `pip install -r requirements.txt`
- Init / migrate schema and seed built-ins: `python -m app.init_db`
- Run dev server: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- All tests: `pytest -q`
- Single test: `pytest -q tests/test_smoke.py::test_room_message_and_mock_turn`

Frontend (run from `frontend/`):

- Install: `pnpm install`
- Dev server (proxies `/api` → `127.0.0.1:8000`): `pnpm dev --host 0.0.0.0 --port 5173`
- Type-check + build: `pnpm build` (`tsc --noEmit && vite build`)
- Vitest: `pnpm test`

Tests hit a real PostgreSQL via `DATABASE_URL` — there is no in-memory fallback. Run `python -m app.init_db` against the same database before `pytest` if the schema does not exist yet.

## Mock vs real LLM mode

`MOCK_LLM` (in `backend/.env`) defaults to `true` and is the assumed mode for development and tests. Even when `MOCK_LLM=false`, any persona whose `backing_model` starts with `mock/` stays deterministic — all built-in personas use `mock/...`, so to exercise a real provider you must create a new persona via `POST /templates/personas` with a LiteLLM-style `backing_model` (e.g. `openai/gpt-4o-mini`). `app/llm.py::LLMAdapter` is the only place that branches on this; both `stream` and `complete_tool` honor the same rule.

## Schema management

There is no Alembic migration in use yet (`backend/alembic/versions/` is empty). Schema is created by `Base.metadata.create_all` plus a small block of idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in `app/db.py::create_schema`. When you add a column to an existing table model, also add a matching `ADD COLUMN IF NOT EXISTS` so existing dev databases pick it up on next startup.

## Engine model (the load-bearing part)

The runtime is intentionally single-process and append-only. Read `app/engine.py` end-to-end before changing scheduling, scribe, or facilitator behavior. Three product invariants drive the design:

1. **One in-flight LLM call per room.** `ACTIVE_CALLS: dict[room_id, InFlightCall]` enforces this, and `freeze_room` cancels the active task by setting `cancel_reason` and calling `task.cancel()`. New persona streams must register/clean up via this dict or freezing won't truncate them.
2. **Append-only.** Messages, verdicts, verdict revocations, and dead-end markers are all new `Message` rows — never edits. Revocation is modeled as a `verdict_revoke` message that points at the revoked verdict via `parent_message_id`, plus a `Decision.revoked_by_message_id` link.
3. **Speakers are picked, not free-running.** `pick_next_speaker` in `engine.py` resolves the active phase's `ordering_rule` (`mention_driven`, `user_picks`, `round_robin`, `alternating`, `parallel`, `question_paired`) into a `NextSpeakerResult`. `mention_driven` and `user_picks` always wait for a user-initiated `POST /rooms/{id}/turn`.

Phase lifecycle: a `Room` has an ordered `RoomPhasePlan`; each entered plan slot creates a `RoomPhaseInstance`. After every appended message `after_message_appended` checks `exit_conditions` (`rounds`, `all_spoken`, `all_voted`, `token_budget`, `facilitator_suggests`, `user_manual`). When met it sets `runtime.phase_exit_suggested=True` and emits `phase.exit_suggested`; the user can `POST /phase/continue` (which records `phase_exit_suppressed_after_message_id` to silence the suggestion until a new message arrives) or `POST /phase/next` to advance. `transition_to_next_phase` always runs the scribe + facilitator at phase boundaries via `run_phase_boundary_tasks`.

Two system roles run on a cadence rather than per-turn:

- **Scribe** (`run_scribe_update`) — every 5th visible message, folds new messages into a structured `ScribeState` (`consensus`, `disagreements`, `open_questions`, `decisions`, `artifacts`, `dead_ends`) using a tool-call schema (`schemas.ScribeUpdate`). Removals must reference an existing item id/message_id/content; additions deduplicate on `message_id` then `content`.
- **Facilitator** (`run_facilitator_eval`) — also every 5th message and at phase boundaries, plus on demand via `POST /rooms/{id}/facilitator`. Output is `observer_only`/`visibility_to_models=False` so discussants never see it. Cooldown is implemented in `filter_facilitator_signals`: a tag emitted in the last `cooldown_per_tag_rounds` signals is suppressed unless `force=True` (manual ask).

Token accounting is intentionally crude — `estimate_tokens` is `len(text)//4`. Per-message and per-room caps live in `RoomRuntimeState.max_message_tokens` / `max_room_tokens`; a stream that would exceed the room cap mid-flight gets truncated with `truncated_reason="limit_exceeded"`.

## Built-ins are content, not code paths

`app/seed.py` defines all built-in personas, phase templates, debate formats, and recipes. They are inserted on first startup keyed by deterministic UUIDv5 ids (`builtin_id(kind, key)`), and `seed_builtins` only runs when the table is empty — there is no upsert. To change a built-in payload after the dev DB is seeded you have to either delete the row or change the seed key. Built-ins reference each other by these deterministic ids (e.g. format → phase template), so renaming a key is a breaking change.

## Backend ↔ frontend contract

API base path is `/api` (proxied by Vite in dev, configurable via `VITE_API_BASE`). All HTTP wrappers live in `frontend/src/api.ts`; types in `frontend/src/types.ts` mirror the Pydantic schemas in `app/schemas.py`. Server-pushed updates flow over a single SSE stream at `/rooms/{id}/events` (see `app/event_bus.py` and `frontend/src/hooks.ts::useRoomEvents`); on most event kinds the hook just invalidates the `["room", roomId]` React Query key — only `message.streaming` mutates Zustand directly to drive the live-typing UI. Adding a new event type means updating both the publisher in `engine.py` / `main.py` and the switch in `useRoomEvents`.

## Trace + uploads

`app/trace.py::trace_record` writes a row to `trace_events` and a JSON sidecar under `backend/trace_payloads/<room_id>/<event_id>.json`. Uploads land under `backend/uploads/<room_id>/`. Both directories are gitignored and created lazily at startup. Only `.md`, `.txt`, and `.pdf` are accepted — PDFs are extracted with `pypdf`.
