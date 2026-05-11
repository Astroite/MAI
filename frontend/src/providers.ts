export const PROVIDER_KINDS = ["openai", "anthropic", "gemini", "openrouter", "azure", "custom"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

const BRAND_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  azure: "Azure OpenAI"
};

export function providerKindLabel(slug: string, t: (key: string) => string): string {
  if (slug in BRAND_LABELS) return BRAND_LABELS[slug];
  if (slug === "custom") return t("api.providerKind.custom");
  return slug;
}

// Slugs whose model id can be auto-prefixed by the backend. Keep in sync with
// `LITELLM_ROUTABLE_SLUGS` in backend/app/llm.py — if you add one there, add
// it here, otherwise users on this slug have to keep hand-typing the prefix.
export const ROUTABLE_SLUGS = new Set<string>(["openai", "anthropic", "gemini", "openrouter", "azure"]);

// Curated picks per slug, shown as <datalist> suggestions in the model form.
// These are stripped of their `slug/` prefix because the backend prepends it
// at call time. The lists are deliberately short — the goal is "click the
// common one" not "exhaustive enumeration"; users can still hand-type
// anything else.
export const SUGGESTED_MODELS: Record<string, Array<{ id: string; label: string }>> = {
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini · fast & cheap" },
    { id: "gpt-4o", label: "GPT-4o · flagship" },
    { id: "o3-mini", label: "o3-mini · reasoning" },
    { id: "o1", label: "o1 · deep reasoning" }
  ],
  anthropic: [
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 · fast" }
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash · fast" }
  ],
  openrouter: [
    // OpenRouter model ids embed the vendor (`vendor/model`), so users must
    // type the openrouter/ routing prefix too — backend only auto-prepends
    // for bare ids without any "/".
    { id: "openrouter/anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5 (via OpenRouter)" },
    { id: "openrouter/openai/gpt-4o-mini", label: "GPT-4o mini (via OpenRouter)" },
    { id: "openrouter/google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)" },
    { id: "openrouter/deepseek/deepseek-chat", label: "DeepSeek Chat (via OpenRouter)" }
  ],
  azure: [],
  custom: []
};

// Friendly default display name for a picked model id (the part after the
// last "/"). The backend computes the same fallback when display_name is
// blank; doing it client-side too means the form preview matches.
export function inferModelDisplayName(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  return tail.replace(/^[a-z]/, (c) => c.toUpperCase());
}
