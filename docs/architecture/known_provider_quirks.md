# Known Provider Quirks

MAI calls LLMs through LiteLLM, including OpenAI-compatible relays and
self-hosted endpoints. Tool calling is intentionally defensive because provider
behavior is not uniform.

## Tool Choice Fallback

`LLMAdapter.complete_tool` has three layers:

1. Forced tool call:
   `tool_choice={"type":"function","function":{"name": tool_name}}`
2. Auto tool call fallback:
   retry with `tool_choice="auto"` and a stronger user instruction to call the
   function exactly once.
3. JSON fallback:
   remove tools entirely and ask for a JSON object that validates against the
   schema.

This fallback is load-bearing. Some providers, including DeepSeek reasoner
models routed through LiteLLM, reject forced `tool_choice` even when they accept
tools or JSON-shaped output. Removing the fallback can break scribe,
facilitator, persona draft, and Story World memory distillation paths.

## Argument Parsing

`_parse_tool_arguments` accepts both real tool-call arguments and raw JSON text.
It normalizes common provider output before Pydantic validation:

- accepts dict arguments directly
- strips markdown JSON fences
- slices leading/trailing prose down to the first `{` and last `}`
- parses JSON strings into dicts

`_unstring_nested` recursively rehydrates nested objects or arrays that arrive
as JSON-encoded strings. This is load-bearing for relays/models that double
encode function arguments, including MiMo-style outputs, some OpenRouter relays,
and self-hosted OpenAI-compatible servers.

Only strings that look like JSON (`{...}` or `[...]`) are parsed, so normal text
fields remain untouched.

## Provider Routing

LiteLLM routes by model string. MAI stores provider credentials in
`api_providers` and model choices in `api_models`, but legacy rows may still
carry `backing_model` plus `api_provider_id`.

Current compatibility behavior:

- If a selected model is bare and the provider slug is routable, the adapter can
  prepend the provider segment expected by LiteLLM.
- OpenAI-compatible proxies and custom providers may need exact model strings.
- Legacy persona and settings fields are still read as fallback snapshots.

Do not make model-string normalization stricter until ApiModel convergence has
tests for provider creation, model creation, default model selection, persona
template binding, room-member overrides, provider deletion, model deletion, and
legacy data.

## Load-Bearing Workarounds

| Workaround | Why it exists | Remove only when |
|---|---|---|
| Forced `tool_choice` -> auto -> raw JSON fallback | Providers disagree on tool-call support and error shape. | A provider compatibility matrix and tests prove every supported route handles a single strategy. |
| `_parse_tool_arguments` prose/fence cleanup | Some models return JSON in text even when asked for tool calls. | JSON/tool-call paths are guaranteed for every supported provider. |
| `_unstring_nested` | Some relays double encode nested tool argument objects/arrays. | Tests cover those relays or the affected routes are no longer supported. |
| Legacy `backing_model` / `api_provider_id` fallback | Older DBs predate `api_models`. | ApiModel dual-field convergence is complete and one release has shipped with legacy write paths disabled. |

When adding a provider-specific workaround, document:

- provider or relay name
- model or model family
- failure mode and error shape
- fallback behavior
- test or manual reproduction notes
