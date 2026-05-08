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
