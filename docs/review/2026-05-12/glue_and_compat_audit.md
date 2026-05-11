# MAI Glue Code, Compat Logic & Migration Residue Audit

> Generated: 2026-05-12 | Scope: read-only audit | No code changes.

---

## Summary

This audit catalogues every instance of legacy compatibility logic, migration residue, fallback chains, dual-write/dual-read patterns, and patch code that has hardened into architecture. Each item is classified by risk and given a recommendation.

**Totals: 31 items found**
- On main critical path: 9
- Legacy fields still affecting new features: 6
- Migrations with no exit plan: 4
- Patch code that became long-term architecture: 5
- Dual-write / dual-read / multi-source truth: 7

---

## Audit Table

### A. Model Resolution — Triple Fallback Chain (MAIN PATH)

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| A1 | `engine.py` | L471-485 `resolve_api_provider()` | Compat fallback | 3-tier provider resolution: `persona.api_model_id` → `settings.default_api_model_id` → `persona.api_provider_id` → `settings.default_api_provider_id`. Every AI turn hits this. | **HIGH** — 4 branches, 4 DB lookups per turn; silent fallback means misconfigured personas produce no error | Yes, until all old DBs migrated | Introduce `ResolvedModel` dataclass; collapse to 2 tiers (instance → global default); remove `api_provider_id` fallback once migration adoption is confirmed | P1 |
| A2 | `engine.py` | L488-540 `resolve_persona_runtime()` | Compat fallback | 2-tier model resolution: `api_model_id` chain → legacy `backing_model + api_provider_id` chain. Overlays resolved values onto detached persona via duck-typing (`session.expunge`). | **HIGH** — duck-typing overlay is fragile; `backing_model` and `api_provider_id` are mutated on the detached object as a side effect | Yes, for old data | Extract a `ResolvedRuntime` NamedTuple; stop mutating the persona object; deprecate `backing_model` path after confirming all rows have `api_model_id` | P1 |
| A3 | `main.py` | L3127-3152 `_template_assistant_runtime()` | Compat fallback | Template draft assistant also has 2-tier model resolution: `default_api_model_id` → `default_backing_model + default_api_provider_id`. | Medium — duplicated resolution logic, not shared with engine | Yes, for old settings | Extract shared `resolve_default_model()` helper used by both engine and main | P2 |

### B. Legacy `backing_model` / `api_provider_id` Fields (MAIN PATH)

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| B1 | `models.py` | L71-74 `PersonaTemplate` | Legacy field | `backing_model` (String 160) + `api_provider_id` (FK) still exist alongside `api_model_id`. New writes set `api_model_id` and blank the old fields. | **HIGH** — every persona template carries 3 model-related columns; `duplicate` (main.py:670-671) copies all 3; delete-provider cascade (main.py:775-805) must clear all 3 on 4 tables | Yes, for migration compat | Add `_ADDED_COLUMNS` deprecation note; once 100% of active rows have `api_model_id`, drop columns via a cleanup migration | P2 |
| B2 | `models.py` | L105-111 `PersonaInstance` | Legacy field | Same triple: `backing_model` + `api_provider_id` + `api_model_id`. Instance snapshot copies all 3 from template. | **HIGH** — same cascade complexity as B1; `resolve_persona_runtime` reads all 3 | Yes, for migration compat | Same as B1 — schedule column drop | P2 |
| B3 | `models.py` | L415-424 `AppSettings` | Legacy field | `default_backing_model` + `default_api_provider_id` + `default_api_model_id` — 3 default columns on the singleton settings row. | Medium — `health` endpoint (main.py:265) checks `default_api_model_id OR (default_backing_model AND default_api_provider_id)` for setup_complete | Yes, for old settings | Same cleanup migration | P2 |
| B4 | `schemas.py` | L153-154, L169-170, L183-184, L209-210, L228-229, L247-248, L269-270, L294-295, L415-424 | Legacy field | `backing_model` and `api_provider_id` appear on 9 Pydantic schemas (PersonaTemplateOut, PersonaTemplateCreate, PersonaTemplateUpdate, and their Instance + AppSettings counterparts). | Medium — frontend types.ts marks them `@deprecated` but backend schemas still accept/return them | Yes, until columns dropped | Remove from schemas after column drop migration | P3 |
| B5 | `types.ts` | L9-12, L36-39, L92-95 | Legacy field | Frontend TypeScript interfaces carry `@deprecated` annotations on `backing_model` and `api_provider_id` for PersonaTemplate, PersonaInstance, AppSettings. | Low — documentation only; no runtime impact | Yes, mirrors backend | Remove after backend cleanup | P3 |
| B6 | `main.py` | L291-312 `_sync_api_model_snapshot()` | Compat glue | Normalizes model payloads: if `api_model_id` present, blanks `backing_model` and `api_provider_id`; if absent, preserves legacy fields for old clients. | Medium — dual-path write logic; called on every persona create/update | Yes, for old clients | Remove after frontend no longer sends legacy fields | P2 |

### C. Migration Layer — No Exit Plan

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| C1 | `models.py` | L26-53 `Persona` class | Legacy table | `personas` table ORM class still defined. Comment says "Kept temporarily so the persona-split migration can read the old rows." Migration (migrate_personas.py) drops the table, but the model class remains. | Medium — dead code on fresh DBs; migration reads from it on old DBs | Only for migration | Remove model class after confirming all target DBs have run `persona_split_v1` | P3 |
| C2 | `models.py` | Legacy `RoomPersona` | Legacy table | `room_personas` join table — superseded by `PersonaInstance.room_id` FK. Still defined in models.py. | Low — migration drops the table; class is dead code | Only for migration | Remove model class | P3 |
| C3 | `migrate_personas.py` | Entire file | One-shot migration | Splits `personas` → `persona_templates` + `persona_instances`. Sentinel: `persona_split_v1`. Drops old tables. | Low — idempotent, well-gated | Yes, for old DBs | Keep; no action needed — sentinel prevents re-run | P4 |
| C4 | `migrate_settings.py` | Entire file | One-shot migration | Blanks `backing_model` on builtins so runtime falls through to `AppSettings.default_backing_model`. | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C5 | `migrate_api_models.py` | Entire file | One-shot migration | Creates `api_models` rows from legacy `(api_provider_id, backing_model)` pairs. | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C6 | `migrate_drop_vendor.py` | Entire file | One-shot migration | Drops `api_providers.vendor` column. | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C7 | `migrate_seed_story_mode.py` | Entire file | One-shot migration | Backfills `story_mode` phase + `story_format` format on existing DBs. | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C8 | `migrate_story_mode_v2.py` | Entire file | One-shot migration | Tightens story-mode role_constraints and prompt_template. | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C9 | `migrate_persona_identity.py` | Entire file | One-shot migration | Backfills `identity` column (name vs role label split). | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C10 | `migrate_seed_new_personas.py` | Entire file | One-shot migration | Inserts 13 new built-in personas on existing DBs. | Low — idempotent | Yes, for old DBs | Keep; sentinel-gated | P4 |
| C11 | `migrate_builtin_personas_update.py` | Entire file | Standing migration | Runs every startup; syncs builtin persona content from seed.py. | Medium — runs on every boot; no version check to skip when unchanged | Yes — enables seed.py iteration | Add a content hash check to skip when seed.py hasn't changed | P3 |
| C12 | `db.py` | L76-132 `_ADDED_COLUMNS` | Schema patch | 33 column-add entries across 9 tables. Self-healing `ALTER TABLE ADD COLUMN` for both SQLite and PostgreSQL. | **HIGH** — growing list; dual DDL per entry; no cleanup mechanism to remove entries for columns now in `create_all` | Yes — required for old DBs | Periodically audit: once all active DBs have run `create_all` with the column in models.py, remove the entry | P2 |

### D. `_sync_api_model_snapshot` — Triple-Field Cascade on Delete

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| D1 | `main.py` | L760-808 `delete_api_provider()` | Dual-write cleanup | Deleting a provider requires 6 UPDATE statements clearing `api_provider_id`, `api_model_id`, and `backing_model` across `PersonaTemplate`, `PersonaInstance`, and `AppSettings` — then another 6 for the model-id path. | **HIGH** — 12 UPDATE statements to maintain referential integrity across 3 columns on 3 tables; easy to miss one | Yes, until legacy columns dropped | Simplify to single-column cleanup after dropping `backing_model`/`api_provider_id` | P1 |
| D2 | `main.py` | L955-975 `delete_api_model()` | Dual-write cleanup | Same pattern: 6 UPDATEs clearing 3 columns on 3 tables when deleting a model. | **HIGH** — same risk as D1 | Yes, until legacy columns dropped | Same as D1 | P1 |

### E. Story World `is_scene_room()` — Tag-Based Branching

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| E1 | `engine.py` | L72-73 `is_scene_room()` | Patch → architecture | `room.world_id is not None` check gates all scene-specific behavior. Used in engine (scribe bypass, facilitator bypass, discussant filtering) and frontend (`isSceneRoom` utility). | Medium — clean now, but every new feature must remember to check; no type-level distinction between Room and Scene | Yes | Consider a `SceneRoom` subtype or at minimum a `room_kind` enum to make the distinction self-documenting | P3 |
| E2 | `engine.py` | L1264-1271 `run_scribe_update()` | Tag-based bypass | Scene rooms skip the room-level scribe. Short-circuit at the top of the function. | Low — well-commented, clear intent | Yes | Acceptable as-is; document in architecture doc | P4 |
| E3 | `engine.py` | L1746-1760 `run_facilitator_eval()` | Tag-based bypass | Scene rooms skip facilitator (unless `force=True`). | Low — well-commented | Yes | Acceptable as-is | P4 |

### F. `_fallback_template_draft` — Hardcoded Fallback

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| F1 | `main.py` | L3155-3200 `_fallback_template_draft()` | Workaround | When the LLM draft endpoint fails (provider error, timeout), the system returns a hardcoded minimal draft from pure string manipulation. Frontend can distinguish this via `rationale` field. | Low — graceful degradation; user sees a usable skeleton | Yes, until LLM reliability improves | Acceptable; consider making the fallback schema-aware rather than string-based | P4 |
| F2 | `main.py` | L504-527 template draft endpoint | Workaround | The draft endpoint catches LLM errors and falls back to `_fallback_template_draft`. Also logs `fallback_shape` into trace for debugging. | Low — defensive coding | Yes | Acceptable | P4 |

### G. Frontend Hardcoded Name Fallbacks

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| G1 | `RoomListSidebar.tsx` | L35-47 | Hardcoded fallback | When creating a quick room from sidebar, falls back to hardcoded persona names (`"架构师"`, `"性能批评者"`, `"维护者"`, `"反方律师"`) and format name (`"方案评审"`) if the default recipe isn't found. | Medium — breaks if built-in names change; Chinese string coupling | Yes, for quick-create flow | Use `builtin_id()` deterministic IDs instead of name matching | P2 |

### H. Scribe State — Append-Only JSON Accumulation

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| H1 | `engine.py` | L1264-1320 `run_scribe_update()` | Patch → architecture | Scribe state is a JSON blob on `ScribeState.current_state` that gets merged (not replaced) via `apply_scribe_update`. Items can be added, resolved, or have dead_ends marked — but never truly deleted, only marked resolved. | Medium — unbounded growth; no compaction mechanism | Yes — append-only is a design invariant | Add periodic compaction that removes long-resolved items | P3 |

### I. `RoomRuntimeState` — Multi-Source State

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| I1 | `models.py` | L262-282 `Room` + L310+ `RoomRuntimeState` | Multi-source truth | Room frozen state is signaled by: (1) `Room.status == "frozen"`, (2) `Room.frozen_at` timestamp, (3) `RoomRuntimeState.frozen` boolean, (4) `Room.sealed_at` for scenes. Four signals for what is conceptually one state. | **HIGH** — engine checks `runtime.frozen` (L448), `room.sealed_at` (L353, L396, L913), and `room.status` in different places; inconsistency risk | Yes, for now | Consolidate: `Room.status` should be the single source; `frozen_at`/`sealed_at` are timestamps for display; `runtime.frozen` can be derived | P2 |

### J. Persona Instance Snapshot — Field Drift Risk

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| J1 | `models.py` | L56-86 `PersonaTemplate` + L89-125 `PersonaInstance` | Dual-write | Template and Instance carry identical field sets: `name`, `identity`, `description`, `backing_model`, `api_provider_id`, `api_model_id`, `system_prompt`, `temperature`, `talkativeness`, `color`, `icon`, `config`, `tags`. Instance is a snapshot copied at creation time. Template updates don't propagate; instance updates don't pollute template. | Medium — 15 fields must stay in sync between two models; `duplicate` (main.py:658-684) copies all of them manually | Yes — snapshot pattern is intentional | Add a `snapshot_from_template()` class method to centralize the copy logic and prevent field drift | P3 |

### K. `seed.py` — Standing Sync Migration

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| K1 | `migrate_builtin_personas_update.py` | Entire file | Standing migration | Runs every startup; iterates all `is_builtin=True` persona templates and overwrites fields from `seed.py::BUILTIN_PERSONAS`. No hash check — always runs. | Medium — O(n) DB writes on every boot even when nothing changed; could cause write contention on slow disks | Yes — enables rapid seed iteration | Add content hash: skip writes when seed.py content hasn't changed since last run | P3 |

### L. LLM Adapter — Three-Tier Tool Choice Fallback

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| L1 | `llm.py` | L184-193 `_complete_tool_auto_fallback()` | Compat fallback | `complete_tool()` tries: (1) forced `tool_choice`, (2) on 400 error, retries with `tool_choice="auto"` + nudge in user message, (3) if still no tool call, drops tools and uses raw JSON mode with schema in system prompt. | Medium — complex retry chain; provider-specific 400 detection; nudge text is hardcoded | Yes — covers DeepSeek, older OpenRouter models | Acceptable; document the 3 tiers in code comments | P3 |

### M. Exporter — ASCII Filename Fallback

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| M1 | `exporter.py` | L49-54 | Fallback | Non-ASCII filenames get an ASCII-safe `filename=` fallback alongside RFC 5987 `filename*=UTF-8''`. | Negligible — standard HTTP behavior | Yes | Acceptable | P5 |

### N. `store.ts` — SSR-Safe localStorage Fallback

| ID | File | Location | Type | Description | Risk | Still Necessary? | Recommendation | Priority |
|----|------|----------|------|-------------|------|-------------------|----------------|----------|
| N1 | `store.ts` | L41-148 | Fallback | Zustand persist uses a `fallbackStorage` shim when `localStorage` is undefined (SSR/Tauri edge case). | Negligible — defensive | Yes | Acceptable | P5 |

---

## Cross-Cutting Patterns

### Pattern 1: Triple-Field Model Resolution

**What:** `backing_model` + `api_provider_id` + `api_model_id` coexist on `PersonaTemplate`, `PersonaInstance`, and `AppSettings`. Every read path must check all 3; every write path must clear/set all 3; every delete cascade must null all 3 on all tables.

**Where:** `engine.py:471-540`, `main.py:291-312`, `main.py:760-808`, `main.py:955-975`, `schemas.py` (9 schemas), `models.py` (3 tables × 3 fields), `types.ts` (3 interfaces × 2 deprecated fields)

**Impact:** 12 UPDATE statements on provider delete; 4-branch resolution on every AI turn; 9 Pydantic schemas carry dead fields.

**Recommendation:** After confirming all active DBs have `api_model_id` populated (via `migrate_api_models.py` sentinel), run a cleanup migration to drop `backing_model` and `api_provider_id` from `PersonaTemplate`, `PersonaInstance`, and `AppSettings`. Simplify `resolve_persona_runtime` to a single tier.

### Pattern 2: `is_scene_room()` Tag-Based Branching

**What:** `room.world_id is not None` is the single check that gates all Story World behavior. Used in 6+ locations in engine.py and frontend.

**Where:** `engine.py:72-73`, `engine.py:1270`, `engine.py:1759`, `engine.py:552`, `utils/scene.ts:5`

**Impact:** Every new feature must remember to check; no type-level enforcement.

**Recommendation:** Low urgency. Consider a `room_kind: Literal["discussion", "scene"]` column or a Python enum to make the distinction self-documenting and greppable.

### Pattern 3: `_ADDED_COLUMNS` as Long-Term Schema Management

**What:** 33 entries in `db.py::_ADDED_COLUMNS` providing dialect-specific `ALTER TABLE ADD COLUMN` for columns added after initial schema. No cleanup mechanism — entries accumulate forever.

**Where:** `db.py:76-132`

**Impact:** Every startup inspects all 9 tables; growing maintenance burden; dual DDL per entry.

**Recommendation:** Periodic audit: when a column has been in `models.py` long enough that all active DBs would have gotten it via `create_all`, remove the `_ADDED_COLUMNS` entry. Consider a version marker.

### Pattern 4: Room State Multi-Source

**What:** Frozen/sealed state is signaled by 4 different fields across 2 tables: `Room.status`, `Room.frozen_at`, `RoomRuntimeState.frozen`, `Room.sealed_at`.

**Where:** `engine.py:353,396,448,913`, `models.py:262-282,310+`

**Impact:** Inconsistency risk — engine checks different signals in different code paths.

**Recommendation:** Consolidate: `Room.status` as single source of truth; `frozen_at`/`sealed_at` as timestamps for display only; derive `runtime.frozen` from status.

### Pattern 5: Frontend Hardcoded Builtin Name Matching

**What:** `RoomListSidebar.tsx` matches builtin personas and formats by Chinese name strings rather than deterministic IDs.

**Where:** `RoomListSidebar.tsx:35-39`

**Impact:** Breaks silently if builtin names change in seed.py.

**Recommendation:** Use `builtin_id(kind, key)` UUIDs or expose a `/scenarios` endpoint that returns the quick-create preset.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| **P1 — Main path, high risk** | 4 | A1, A2, D1, D2 |
| **P2 — Legacy fields, medium risk** | 7 | A3, B1, B2, B3, B6, C12, G1, I1 |
| **P3 — Cleanup candidates** | 8 | B4, B5, C11, E1, H1, J1, K1, L1 |
| **P4 — Acceptable as-is** | 7 | C3-C10, E2, E3, F1, F2 |
| **P5 — Negligible** | 2 | M1, N1 |
