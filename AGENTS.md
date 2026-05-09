# AGENTS.md

MAI is a multi-model collaborative discussion platform: single-process FastAPI backend (`backend/app`) + Vite + React + TypeScript frontend (`frontend/src`); SQLite by default, optional PostgreSQL via `DATABASE_URL`.

## Source-of-truth docs (read before changing semantics)

- @docs/product/product_design.md — product intent, core objects, user flows
- @docs/product/story_world.md — World / Scene / Character / Memory subsystem
- @docs/product/personas.md — built-in persona taxonomy (25 personas)
- @docs/architecture/technical_design.md — data model, engine invariants, migration policy, backend↔frontend contract
- @docs/ops/usage.md — running, configuring, packaging
- @docs/ops/desktop_tauri.md — Tauri desktop shell build
- @docs/status.md — module status snapshot
- @docs/design/ui_brief.md — visual direction reference

## Non-obvious rules

- Read `app/engine.py` end-to-end before changing scheduling, scribe, autodrive, or facilitator behavior. Three invariants drive the design (in-flight tracked per room+message, append-only, speakers are picked) — see the architecture doc.
- Schema is `Base.metadata.create_all` + a self-healing column-add list in `app/db.py::_ADDED_COLUMNS`. **No Alembic.** Adding a column to an existing table requires appending dialect-specific DDL there, or schema upgrades silently break older DBs.
- Built-ins are **content** (`app/seed.py`), inserted only when the target table is empty. Changing a seeded payload requires either an idempotent one-shot migration (gated on `is_builtin=1`) or a key rename — built-ins are referenced by deterministic `builtin_id(kind, key)` UUIDv5 ids, so renaming a key is a breaking change.
- Tests hit real LLM endpoints: put `OPENAI_API_KEY` in `backend/tests/.env.test` (gitignored); `pytest` must be run from `backend/`.
- All API routes are declared at root; `_strip_api_prefix` middleware in `app/main.py` rewrites `/api/...` → root. New routes must be added **above** the SPA mount block at the bottom of `main.py`.
- `CLAUDE.md` is the Claude-Code-facing mirror of this file — keep them in sync.
