# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project shape

MAI is a multi-model collaborative discussion platform. It is a single-process FastAPI backend (`backend/app`) plus a Vite + React + TypeScript frontend (`frontend/src`). Default storage is a local SQLite file; PostgreSQL is opt-in via `DATABASE_URL` (still tested and supported). The product and technical design specs in `docs/` are authoritative for intent — read them before changing engine semantics.

## Common commands

One-shot Windows bootstrap (creates `.venv`, runs `init_db`, installs frontend deps, launches both servers): `.\scripts\dev.ps1`. The script also tries to start PostgreSQL via Docker; with the default SQLite backend you can pass `-SkipPostgres`. Other skips: `-SkipInstall`, `-SkipDbInit`.

PostgreSQL is optional: `docker compose -f infra/docker-compose.yml up -d postgres` (matches the commented-out `DATABASE_URL` in `.env.example`).

Backend (run from `backend/` with the `.venv` activated):

- Install: `pip install -r requirements.txt`
- Init / migrate schema and seed built-ins: `python -m app.init_db`
- Run dev server: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- All tests: `pytest -q` (suite is split by topic under `tests/`, with shared fixtures in `tests/conftest.py`)
- Single test: `pytest -q tests/test_room_lifecycle.py::test_room_full_lifecycle`

Tests hit real LLM endpoints — put your provider key in `backend/tests/.env.test` (gitignored). `conftest.py` loads it and exits early with a clear message if no `OPENAI_API_KEY` is present; there is no mock fallback.

Frontend (run from `frontend/`):

- Install: `pnpm install`
- Dev server (proxies `/api` → `127.0.0.1:8000`): `pnpm dev --host 0.0.0.0 --port 5173`
- Type-check + build: `pnpm build` (`tsc --noEmit && vite build`)
- Vitest: `pnpm test`
- Tauri CLI: `pnpm tauri --version`

Tests run against whatever `DATABASE_URL` resolves to — by default that's a local SQLite file (`backend/mai.sqlite3` in dev, `%APPDATA%/MAI/mai.sqlite3` when packaged), which `create_schema` builds on the first connection. If you've pointed `DATABASE_URL` at PostgreSQL, run `python -m app.init_db` against that DB before `pytest`.

Release packaging: `.\scripts\package.ps1 -Version vX.Y.Z` stages a bundle under `release/mai-<version>/`. Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml` to publish a GitHub Release.

Desktop packaging: `.\scripts\build-sidecar.ps1` builds the PyInstaller backend sidecar, and `.\scripts\package-tauri.ps1` builds the Tauri installer. This requires Rust/Cargo, Microsoft C++ Build Tools, and WebView2; see `docs/desktop_tauri.md`.

## Schema management

There is no migrations system (no Alembic). Schema is created by `Base.metadata.create_all` plus a self-healing column-add pass in `app/db.py::_ensure_runtime_state_columns` — it inspects the live table via SQLAlchemy's `inspect()` and only emits `ALTER TABLE ... ADD COLUMN` for columns missing from an older DB. Each entry in `_RUNTIME_STATE_ADDED_COLUMNS` carries dialect-specific DDL so PostgreSQL and SQLite stay in sync. When you add a column to an existing table model, append a tuple to that list (or move the column model itself to satisfy `create_all` for fresh DBs).

Cross-dialect JSON columns use `JSONType = JSON().with_variant(JSONB(), "postgresql")` (defined in `app/models.py`) — PG users still get JSONB; SQLite gets the standard JSON type.

## Engine model (the load-bearing part)

The runtime is intentionally single-process and append-only. Read `app/engine.py` end-to-end before changing scheduling, scribe, or facilitator behavior. Three product invariants drive the design:

1. **In-flight calls are tracked per room and message.** `ACTIVE_CALLS: dict[room_id, dict[message_id, InFlightCall]]` tracks currently streaming persona calls. Ordinary/autodrive turns short-circuit while a room has active calls; explicit `parallel` phases may register several message-scoped calls. `freeze_room` cancels every active call for the room by setting `cancel_reason` and calling `task.cancel()`. New persona streams must register/clean up via this dict or freezing won't truncate them.
2. **Append-only.** Messages, verdicts, verdict revocations, and dead-end markers are all new `Message` rows — never edits. Revocation is modeled as a `verdict_revoke` message that points at the revoked verdict via `parent_message_id`, plus a `Decision.revoked_by_message_id` link.
3. **Speakers are picked, not free-running.** `pick_next_speaker` in `engine.py` resolves the active phase's `ordering_rule` (`mention_driven`, `user_picks`, `round_robin`, `alternating`, `parallel`, `question_paired`) into a `NextSpeakerResult`. `user_picks` waits for a user-initiated `POST /rooms/{id}/turn`; `mention_driven` first resolves @-mentions from the latest user-visible messages, then falls back to round-robin so default rooms can autodrive.

Autodrive is triggered from `after_message_appended` through `maybe_autodrive_after`: user-authored speech/question/answer/user_doc messages schedule one background `run_room_turn`, while AI-authored replies never recursively schedule another turn. Per-room autodrive locks prevent queue buildup; users can still explicitly call `/turn`.

Phase lifecycle: a `Room` has an ordered `RoomPhasePlan`; each entered plan slot creates a `RoomPhaseInstance`. After every appended message `after_message_appended` checks `exit_conditions` (`rounds`, `all_spoken`, `all_voted`, `token_budget`, `facilitator_suggests`, `user_manual`). When met it sets `runtime.phase_exit_suggested=True` and emits `phase.exit_suggested`; the user can `POST /phase/continue` (which records `phase_exit_suppressed_after_message_id` to silence the suggestion until a new message arrives) or `POST /phase/next` to advance. `transition_to_next_phase` always runs the scribe + facilitator at phase boundaries via `run_phase_boundary_tasks`.

Two system roles run on a cadence rather than per-turn:

- **Scribe** (`run_scribe_update`) — every 5th visible message, folds new messages into a structured `ScribeState` (`consensus`, `disagreements`, `open_questions`, `decisions`, `artifacts`, `dead_ends`) using a tool-call schema (`schemas.ScribeUpdate`). Removals must reference an existing item id/message_id/content; additions deduplicate on `message_id` then `content`.
- **Facilitator** (`run_facilitator_eval`) — also every 5th message and at phase boundaries, plus on demand via `POST /rooms/{id}/facilitator`. Output is `observer_only`/`visibility_to_models=False` so discussants never see it. Cooldown is implemented in `filter_facilitator_signals`: a tag emitted in the last `cooldown_per_tag_rounds` signals is suppressed unless `force=True` (manual ask).

Token accounting is intentionally crude — `estimate_tokens` is `len(text)//4`. Per-message and per-room caps live in `RoomRuntimeState.max_message_tokens` / `max_room_tokens`; a stream that would exceed the room cap mid-flight gets truncated with `truncated_reason="limit_exceeded"`.

## Built-ins are content, not code paths

`app/seed.py` defines all built-in personas, phase templates, debate formats, and recipes. They are inserted on first startup keyed by deterministic UUIDv5 ids (`builtin_id(kind, key)`), and `seed_builtins` only runs when the table is empty — there is no upsert. To change a built-in payload after the dev DB is seeded you have to either delete the row or change the seed key. Built-ins reference each other by these deterministic ids (e.g. format → phase template), so renaming a key is a breaking change.

## Backend ↔ frontend contract

Frontend wrappers in `frontend/src/api.ts` and `hooks.ts` always prefix `/api` (override via `VITE_API_BASE`). Backend route decorators are declared at root (`/health`, `/rooms`, …) — a tiny `_strip_api_prefix` middleware in `app/main.py` rewrites incoming `/api/...` to root before routing, so the same frontend build works against both Vite's dev proxy and the single-process serve. Tests hit root paths directly, bypassing the middleware. Types in `frontend/src/types.ts` mirror the Pydantic schemas in `app/schemas.py`.

Server-pushed updates flow over a single SSE stream at `/rooms/{id}/events` (see `app/event_bus.py` and `frontend/src/hooks.ts::useRoomEvents`); on most event kinds the hook just invalidates the `["room", roomId]` React Query key — only `message.streaming` mutates Zustand directly to drive the live-typing UI. Adding a new event type means updating both the publisher in `engine.py` / `main.py` and the switch in `useRoomEvents`.

Single-process serve: when `frontend/dist/index.html` exists, `MAI_FRONTEND_DIST` points at one, or a PyInstaller `_MEIPASS/frontend-dist` bundle exists, `app/main.py` mounts an `SPAStaticFiles` instance at `/` that serves built assets and falls back to `index.html` on any 404 — that's how a packaged build hosts the UI without a separate Vite process. Mount happens at the bottom of `main.py` after all API routes, so route registration order matters: any new `@app.<method>` must be added above the mount block.

Tauri desktop shell: `frontend/src-tauri` creates the window manually after spawning the `mai-backend` sidecar on an ephemeral localhost port. It injects `window.__MAI_API_BASE__` before the SPA loads; `frontend/src/api.ts` must keep that value ahead of `VITE_API_BASE` and `/api`.

Room UI is composed in `frontend/src/pages/room/RoomShell.tsx` (three-column layout: `RoomListSidebar` / `MessageList` + `Composer` / `RightPanel`) and a set of right-rail panels under `frontend/src/pages/room/panels/` (Scribe, Facilitator, Decisions, PhasePlan, Subroom, Upload, Limit). `pages/RoomPage.tsx` is a thin wrapper — extend the panels rather than the page. The shared `frontend/src/components/` directory only holds primitive bits (`MarkdownBlock`, `StatusPill`).

## Trace + uploads

`app/trace.py::trace_record` writes a row to `trace_events` and a JSON sidecar under `<trace_payload_dir>/<room_id>/<event_id>.json`. Uploads land under `<upload_dir>/<room_id>/`. In dev these resolve to `backend/trace_payloads/` and `backend/uploads/` (gitignored, created lazily at startup); in packaged mode (`MAI_PACKAGED=1` or `sys.frozen`) they default to `<APPDATA>/MAI/trace_payloads/` and `<APPDATA>/MAI/uploads/`. Only `.md`, `.txt`, and `.pdf` are accepted — PDFs are extracted with `pypdf`.

## Sibling agent docs

`CLAUDE.md` is a near-verbatim copy of this file aimed at Claude Code. When you change architecture-level guidance here, mirror it there (or vice versa) so the two assistants don't drift.
