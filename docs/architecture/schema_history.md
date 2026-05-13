# Schema History

MAI does not use Alembic. Startup runs `Base.metadata.create_all`, then
`app/db.py::_ensure_added_columns`, then the migration helpers imported in
`create_schema()`.

This file records which compatibility paths are load-bearing. Do not delete a
migration just because it has no effect on a fresh database.

## Startup Order

1. `Base.metadata.create_all`
2. `_ensure_added_columns`
3. `migrate_personas.run`
4. `migrate_settings.run`
5. `migrate_api_models.run`
6. `migrate_drop_vendor.run`
7. `migrate_seed_story_mode.run`
8. `migrate_story_mode_v2.run`
9. `migrate_phase_auto_discuss_mode.run`
10. `migrate_persona_identity.run`
11. `migrate_seed_new_personas.run`
12. `migrate_builtin_personas_update.run`

## Self-Healing Columns

`_ensure_added_columns` is the schema compatibility layer for existing
databases. Any column added to an existing table must be appended to
`app/db.py::_ADDED_COLUMNS` with PostgreSQL and SQLite DDL.

Current self-healed tables:

| Table | Added columns | Still required? |
|---|---|---|
| `room_runtime_state` | phase exit fields, token caps, AI-turn caps, extra rounds | Yes. Older rooms need these runtime defaults. |
| `personas` | `api_provider_id` | Yes until all pre-split persona DBs are unsupported. |
| `persona_templates` | `api_model_id`, `talkativeness`, `color`, `icon`, `identity` | Yes. These columns landed after the original template table. |
| `persona_instances` | `api_model_id`, `talkativeness`, `color`, `icon`, `identity`, `world_character_id` | Yes. Room snapshots and Story World binding depend on them. |
| `api_providers` | `last_tested_ok`, `last_tested_at`, `last_tested_error` | Yes for older settings DBs. |
| `app_settings` | `default_api_model_id` | Yes until legacy default model fields are fully retired. |
| `messages` | `user_masquerade_name` | Yes for guest-message compatibility. |
| `rooms` | `background`, Story World scene fields, `sealed_at` | Yes. Scene rooms are still represented by `rooms.world_id`. |
| `phase_templates` | `auto_discuss`, `auto_discuss_mode` | Yes for Story/free-chat phases. |
| `world_character_memories` | `last_used_scene_index` | Yes for memory decay. |

## Migration Files

| File | Sentinel / cadence | Purpose | Affected tables | Still required? | Safe deletion condition |
|---|---|---|---|---|---|
| `migrate_personas.py` | `_migrations.name = persona_split_v1` | Splits legacy `personas` and `room_personas` into `persona_templates` and `persona_instances`, preserving template ids and rewriting message/runtime persona references. Drops the legacy tables after migration. | `personas`, `room_personas`, `persona_templates`, `persona_instances`, `messages`, `room_runtime_state` | Yes. It is load-bearing for DBs created before template/instance split. | Only after all supported user DBs are known to have no `personas` / `room_personas` tables, or after a separate release-gated upgrade path has applied this migration. |
| `migrate_settings.py` | `_migrations.name = clear_builtin_backing_model_v1` | Clears built-in `backing_model` so built-ins fall through to app-level default model settings. Leaves user-authored rows alone. | `persona_templates`, `persona_instances` | Yes for DBs created before default API settings. | Only after pre-default-settings DBs are unsupported, or after validation shows every supported DB has the sentinel and no built-in model pins that should fall through. |
| `migrate_api_models.py` | `_migrations.name = api_models_v1` | Creates `api_models` from legacy `(api_provider_id, backing_model)` pairs and points settings/templates/instances at `api_model_id`. Legacy fields remain compatibility snapshots. | `api_models`, `app_settings`, `persona_templates`, `persona_instances` | Yes. This is the bridge for the current ApiModel dual-field state. | Not before ApiModel convergence is complete and legacy fields are read-only for at least one release cycle. |
| `migrate_drop_vendor.py` | `_migrations.name = drop_api_provider_vendor_v1` | Drops legacy `api_providers.vendor`; UI now derives provider labels from `provider_slug`. | `api_providers` | Yes for DBs that still have the old column. | Only after old DBs with `vendor` are unsupported or an external schema audit confirms none remain. |
| `migrate_seed_story_mode.py` | `_migrations.name = seed_story_mode_v1` | Inserts the built-in Story Mode phase and format into DBs seeded before Story Mode existed. Uses deterministic `builtin_id` and skips existing rows. | `phase_templates`, `debate_formats` | Yes for older DBs because `seed_builtins` only inserts when target tables are empty. | Only after all supported DBs are guaranteed to contain the Story Mode phase/format or after a new built-in content migration supersedes it. |
| `migrate_story_mode_v2.py` | `_migrations.name = story_mode_v2_no_narrator` | Updates the built-in Story Mode phase prompt to prevent omniscient narration and speaking for other characters. Touches only the built-in row. | `phase_templates` | Yes for DBs that already had Story Mode v1. | Only after all supported DBs have the v2 sentinel, or if a standing built-in phase updater replaces this one-shot. |
| `migrate_phase_auto_discuss_mode.py` | `_migrations.name = phase_auto_discuss_mode_v1` | Backfills `auto_discuss_mode='continuous'` for existing auto-discuss phases tagged `story`, moving scheduling semantics out of free-form tags. | `phase_templates` | Yes for DBs created before explicit auto-discuss pacing. | Only after all supported DBs have `auto_discuss_mode` populated and no runtime fallback depends on old rows. |
| `migrate_persona_identity.py` | `_migrations.name = persona_identity_v1` | Backfills `identity` for templates and instances. Built-ins get deterministic name/identity pairs; user-authored rows copy old `name` into blank `identity`. | `persona_templates`, `persona_instances` | Yes. The UI and persona display model rely on split name/identity semantics. | Only after all supported DBs already have populated `identity` fields and the sentinel. |
| `migrate_seed_new_personas.py` | `_migrations.name = seed_new_personas_v1` | Adds later built-in personas to existing DBs that were seeded before the expanded persona library. | `persona_templates` | Yes because built-ins are content, not schema, and initial seeding is table-empty only. | Only after all supported DBs include these deterministic built-in ids, or after a broader built-in content sync supersedes it. |
| `migrate_builtin_personas_update.py` | Runs every startup; no `_migrations` sentinel | Standing idempotent updater for built-in persona content. Updates built-in rows when `seed.py` version is higher; never touches user duplicates. | `persona_templates` | Yes. This is the current supported path for changing seeded built-in persona text. | Only after a replacement built-in content versioning system exists. Do not convert it to a one-shot migration without preserving version-gated updates. |

## Deletion Rules

- Do not delete a migration while any supported DB might still need it.
- Do not remove `_ADDED_COLUMNS` entries until the corresponding old schema is
  no longer supported.
- Built-in content changes are not regular seed edits. Because `seed_builtins`
  only inserts into empty tables, existing DBs need either deterministic
  version-gated updates or a new one-shot migration.
- Legacy model fields (`backing_model`, `api_provider_id`) remain compatibility
  snapshots until ApiModel convergence is complete.
