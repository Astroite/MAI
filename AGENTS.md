# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project shape

MAI is a multi-model collaborative discussion platform. It is a single-process FastAPI backend (`backend/app`) plus a Vite + React + TypeScript frontend (`frontend/src`). Default storage is a local SQLite file; PostgreSQL is opt-in via `DATABASE_URL` (still tested and supported). The product and technical design specs in `docs/` are authoritative for intent — read them before changing engine semantics.

## Common commands

One-shot Windows bootstrap (creates `.venv`, runs `init_db`, installs frontend deps, launches both servers): `.\scripts\dev.ps1`. The script also tries to start PostgreSQL via Docker; with the default SQLite backend you can pass `-SkipPostgres`. Other skips: `-SkipInstall`, `-SkipDbInit`.

PostgreSQL is optional: `docker compose -f infra/docker-compose.yml up -d postgres` (matches the commented-out `DATABASE_URL` in `.env.example`).

Backend (run from `backend/` with the `.venv` activated):

- Install: `pip install -r requirements.txt`
- Install test/build tooling: `pip install -r requirements-dev.txt`
- Init / migrate schema and seed built-ins: `python -m app.init_db`
- Run dev server: `uvicorn app.main:app --reload --host 0.0.0.0 --port 47821`
- All tests: `pytest -q` (suite is split by topic under `tests/`, with shared fixtures in `tests/conftest.py`). Async fixtures use function-scoped loops (`asyncio_default_fixture_loop_scope = function`).
- Single test: `pytest -q tests/test_room_lifecycle.py::test_room_full_lifecycle`

Tests hit real LLM endpoints — put your provider key in `backend/tests/.env.test` (gitignored). `conftest.py` loads it and exits early with a clear message if no `OPENAI_API_KEY` is present; there is no mock fallback.

Frontend (run from `frontend/`):

- Install: `pnpm install`
- Dev server (proxies `/api` → `127.0.0.1:47821`): `pnpm dev --host 0.0.0.0 --port 5173`
- Type-check + build: `pnpm build` (`tsc --noEmit && vite build`)
- Vitest: `pnpm test`
- Tauri CLI: `pnpm tauri --version`

Tests default to an isolated SQLite database at `backend/tests/.runtime/mai_test.sqlite3`, reset at session start so pytest data does not pollute `backend/mai.sqlite3`. To test PostgreSQL or another database, set `DATABASE_URL` explicitly in `backend/tests/.env.test`.

Release packaging: `.\scripts\package.ps1 -Version vX.Y.Z` stages a bundle under `release/mai-<version>/`. Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml` to publish a GitHub Release.

Desktop packaging: `.\scripts\build-sidecar.ps1` builds the PyInstaller backend sidecar (entry point: `backend/mai_backend_main.py`), and `.\scripts\package-tauri.ps1` builds the Tauri installer. This requires Rust/Cargo, Microsoft C++ Build Tools, and WebView2; see `docs/desktop_tauri.md`.

## Schema management

There is no migrations system (no Alembic). Schema is created by `Base.metadata.create_all` plus a self-healing column-add pass in `app/db.py::_ensure_added_columns` — it inspects the live table via SQLAlchemy's `inspect()` and only emits `ALTER TABLE ... ADD COLUMN` for columns missing from an older DB. Each entry in `_ADDED_COLUMNS` carries dialect-specific DDL so PostgreSQL and SQLite stay in sync. When you add a column to an existing table model, append a tuple to that list (or move the column model itself to satisfy `create_all` for fresh DBs).

One-shot data migrations live beside the app (`migrate_personas.py`, `migrate_settings.py`, `migrate_api_models.py`, `migrate_drop_vendor.py`) and record completion in `_migrations`. New data migrations should be idempotent and called from `create_schema`.

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

## API provider/model model

The current API configuration is two-layered: an `ApiProvider` (user-readable `name` + LiteLLM `provider_slug` enum + credentials) and one or more `ApiModel` rows under each provider. Settings should point at `AppSettings.default_api_model_id`; persona templates and room persona instances can also carry `api_model_id`. `backing_model` and `api_provider_id` remain as legacy mirror/fallback fields, and route helpers keep them in sync when `api_model_id` is selected. New UI should prefer model selection over free-text model/provider pairs. The `provider_slug` enum is `openai` / `anthropic` / `gemini` / `openrouter` / `azure` / `custom`; the frontend renders friendly labels via `frontend/src/providers.ts::providerKindLabel`.

`app/llm.py` wraps LiteLLM for streaming and tool-call dispatch. Deep thinking is supported via `config.deep_thinking` — it maps to Anthropic's `thinking` parameter or OpenAI's `reasoning_effort: "high"` depending on provider.

## Tools & MCP integration

Persona turns can call tools via a schema-driven path; `app/tools.py` is the registry. `BUILTIN_TOOLS` lists in-process tools (`mai_search_room_messages`, `mai_list_room_members`, `mai_create_persona_template`, `mai_create_phase_template`); `list_tool_schemas` merges these with tools discovered from configured `ToolServer` rows so models see one flat tool list.

`ToolServer` (MCP server config: `transport=streamable_http|sse`, `url`, `allow_write`, cached `manifest`, `last_synced_at`) and `ToolInvocation` (per-message audit row: `tool_name`, `arguments`, `status`, `result`) are real DB models in `app/models.py`. Each tool call appends a `ToolInvocation` linked to the originating `Message`, so the trail is append-only just like the message log.

MCP servers are user-configurable via `/tools/mcp-servers` (list/create/update/delete) and `/tools/mcp-servers/{id}/sync`. `execute_tool` in `tools.py` dispatches built-ins locally and routes MCP calls through an MCP client session; tools with `read_only=False` only run when the calling server has `allow_write=True`. Tool names from MCP servers are namespaced via `external_tool_name(server, raw_name)` to avoid collisions with built-ins or other servers.

Frontend surfaces this in `frontend/src/pages/room/panels/ToolPanel.tsx` (manage servers, sync manifest, ad-hoc execute), and per-room `tool_invocations` are streamed alongside messages — `frontend/src/types.ts` carries `ToolSchema`, `ToolServer`, `ToolInvocation`.

## Built-ins are content, not code paths

`app/seed.py` defines all built-in personas, phase templates, debate formats, and recipes. They are inserted on first startup keyed by deterministic UUIDv5 ids (`builtin_id(kind, key)`), and `seed_builtins` only seeds a template table when that table is empty — there is no upsert. To change a built-in payload after the dev DB is seeded you have to either delete the row/table or change the seed key. Built-ins reference each other by these deterministic ids (e.g. format → phase template), so renaming a key is a breaking change. The persona taxonomy (12 personas across 7 categories) is documented in `docs/personas.md`.

Built-ins are read-only at the API layer. The product flow is duplicate-then-edit: template pages show editable instances by default, and the Add action copies from the immutable built-in library.

## Backend ↔ frontend contract

Frontend wrappers in `frontend/src/api.ts` and `hooks.ts` always prefix `/api` (override via `VITE_API_BASE`). Backend route decorators are declared at root (`/health`, `/rooms`, …) — a tiny `_strip_api_prefix` middleware in `app/main.py` rewrites incoming `/api/...` to root before routing, so the same frontend build works against both Vite's dev proxy and the single-process serve. Tests hit root paths directly, bypassing the middleware. Types in `frontend/src/types.ts` mirror the Pydantic schemas in `app/schemas.py`.

Server-pushed updates flow over a single SSE stream at `/rooms/{id}/events` (see `app/event_bus.py` and `frontend/src/hooks.ts::useRoomEvents`); on most event kinds the hook just invalidates the `["room", roomId]` React Query key — only `message.streaming` mutates Zustand directly to drive the live-typing UI. Adding a new event type means updating both the publisher in `engine.py` / `main.py` and the switch in `useRoomEvents`.

Single-process serve: when `frontend/dist/index.html` exists, `MAI_FRONTEND_DIST` points at one, or a PyInstaller `_MEIPASS/frontend-dist` bundle exists, `app/main.py` mounts an `SPAStaticFiles` instance at `/` that serves built assets and falls back to `index.html` on any 404 — that's how a packaged build hosts the UI without a separate Vite process. Mount happens at the bottom of `main.py` after all API routes, so route registration order matters: any new `@app.<method>` must be added above the mount block.

Tauri desktop shell: `frontend/src-tauri` creates the window manually after spawning the `mai-backend` sidecar on an ephemeral localhost port. It injects `window.__MAI_API_BASE__` before the SPA loads; `frontend/src/api.ts` must keep that value ahead of `VITE_API_BASE` and `/api`.

Room UI is composed in `frontend/src/pages/room/RoomShell.tsx` (three-column layout: `RoomListSidebar` / `MessageList` + `Composer` / `RightPanel`) and a set of right-rail panels under `frontend/src/pages/room/panels/` (Scribe, Facilitator, Decisions, PhasePlan, Subroom, Upload, Limit, Tool). `pages/RoomPage.tsx` is a thin wrapper — extend the panels rather than the page. The shared `frontend/src/components/` directory holds reusable UI primitives (`AppRail`, `MarkdownBlock`, `StatusPill`, `MentionChip`, `PhaseStepper`, `SectionCard`, `ConfirmDialog`, `Toaster`).

Styling uses Tailwind CSS with a custom design token system: CSS variables in `styles.css` (`--border`, `--panel`, `--surface`, `--text`, `--muted`, `--brand`, etc.) are mapped through `tailwind.config.ts` as color utilities. Dark mode toggles via the `class` strategy. `store.ts` (Zustand) persists dark mode preference to localStorage and manages transient streaming message state and SSE connection status.

Frontend internationalization lives in `frontend/src/i18n.tsx` (`I18nProvider`, `useI18n`, `LanguageToggle`, `t`, `display`). User-visible strings and internal enum labels should go through i18n; user-authored room/template/message content should not be auto-translated.

## Trace + uploads

`app/trace.py::trace_record` writes a row to `trace_events` and a JSON sidecar under `<trace_payload_dir>/<room_id>/<event_id>.json`. Uploads land under `<upload_dir>/<room_id>/`. In dev these resolve to `backend/trace_payloads/` and `backend/uploads/` (gitignored, created lazily at startup); in packaged mode (`MAI_PACKAGED=1` or `sys.frozen`) they default to `<APPDATA>/MAI/trace_payloads/` and `<APPDATA>/MAI/uploads/`. Only `.md`, `.txt`, and `.pdf` are accepted — PDFs are extracted with `pypdf`.

## Sibling agent docs

`CLAUDE.md` is a near-verbatim copy of this file aimed at Claude Code. When you change architecture-level guidance here, mirror it there (or vice versa) so the two assistants don't drift.
