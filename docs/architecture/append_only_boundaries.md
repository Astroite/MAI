# Append-Only Boundaries

This document separates immutable event history from mutable state mirrors.
When changing runtime, scribe, tools, scene, or provider behavior, preserve
these boundaries unless the product semantics explicitly change.

## Append-Only Event History

| Table / object | Boundary | Notes |
|---|---|---|
| `messages` | Append-only within a room. Do not edit prior content to express new user-visible facts. | Freezing/truncation creates or finalizes a message with `truncated_reason`; verdict revoke and dead-end are represented by new messages. |
| `decisions` | Decision rows are historical records keyed to scribe events. | Revoke by setting `revoked_by_message_id`; do not erase the original decision. |
| `tool_invocations` | Tool call audit trail. | Status/result/error may complete the pending row, but calls should remain queryable and tied to their message when available. |
| `trace_events` | Operational audit trail. | Use for state mutations, fallbacks, failures, and future provider/model cleanup snapshots. |
| `room_snapshots` | Point-in-time state snapshots. | Used around freeze/delete flows; do not mutate old snapshots. |

Append-only means user-visible chronology should be reconstructable from rows,
not from overwriting old messages or deleting evidence.

## Mutable State Mirrors

| Table / object | Role | Mutation expectations |
|---|---|---|
| `room_runtime_state` | Current room execution state: phase pointer, frozen flag, token counters, phase-exit hints, AI-turn counters. | Mutable. It is a runtime mirror, not the transcript. |
| `scribe_states` | Latest folded scribe state for a discussion room. | Mutable current summary. Individual decisions still need historical rows. |
| `facilitator_signals` | Timestamped facilitator observations. | Append rows for signals; UI may show latest N. |
| `tool_servers` | MCP server configuration and sync status. | Mutable configuration. Deleting a server can null `tool_invocations.server_id` but should keep invocation rows. |
| `app_settings`, `api_providers`, `api_models` | Configuration. | Mutable. Deletion side effects must preserve enough trace/snapshot context for debugging. |

## Story World State

| Table / object | Boundary | Notes |
|---|---|---|
| `worlds` | Mutable world metadata. | Name, synopsis, setting, calendar, and status are editable product state. |
| `world_characters` | Mutable character profile. | Edits affect future scene prompts only; they do not rewrite sealed-scene memories. |
| `rooms` with `world_id` | Scene room. | `world_id + scene_index` identifies a Scene until the Story Domain is split from the conversation runtime. |
| `world_scene_members` | Roster membership interval. | Enter/exit should be reflected by participant messages; v1 supports one roster row per character per scene. |
| `world_scene_seal_drafts` | Editable seal proposal. | Draft rows can be retried, edited, discarded, or committed. They are not durable world facts until commit. |
| `world_character_memories` | Long-term character memory. | Seal Draft commit appends or updates memory state and stamps `seal_draft_id`. Backstory/manual rows are authored state. Memory decay/cap may update/drop non-backstory rows; this is bounded maintenance, not transcript rewrite. |
| `world_character_relations` | Long-term relation cards. | Updated after Seal Draft commit. Treat as current relationship state with traceable `last_updated_scene_id` and `last_updated_seal_draft_id`. |

Seal draft generation pauses the scene so the transcript being inspected stays
stable. Scene sealing is the commit boundary: after `sealed_at`, the scene should
not accept new members or new dialogue, and memory/relation writes represent the
durable output of that scene.

## Provider / Model Deletion Side Effects

Deleting an `ApiProvider` or `ApiModel` currently clears model references from:

- `persona_templates`
- `persona_instances`
- `app_settings`

This is configuration cleanup, not append-only conversation history. It is still
semantically significant because future AI routing changes. Future work should
record trace events or snapshots that include:

- deleted provider/model id and display name
- affected template ids
- affected room instance ids
- affected default settings
- replacement or fallback model, if any

Do not silently erase enough context that a later failed AI call cannot be
explained.

## Implementation Rules

- New user-visible events should usually append `messages`, `decisions`,
  `tool_invocations`, `facilitator_signals`, or `trace_events`.
- Runtime toggles and counters belong in `room_runtime_state`.
- Discussion summaries belong in `scribe_states`, but evidence belongs in
  messages and decision rows.
- Story memories and relations are scene outputs; do not backfill them by
  rewriting old dialogue.
- Before deleting rooms/scenes, drain active calls so background tasks cannot
  write after the owning runtime has been removed.
