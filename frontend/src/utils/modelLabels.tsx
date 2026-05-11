import type { ReactNode } from "react";
import type { ApiModel, ApiProvider } from "../types";
import { providerKindLabel } from "../providers";

type TFunction = (key: string) => string;
type ModelLabelOptions = { defaultLabelKey?: string };

export function providerDisplayName(provider: ApiProvider | undefined, t: TFunction): string {
  if (!provider) return t("room.noProvider");
  return `${provider.name} · ${providerKindLabel(provider.provider_slug, t)}`;
}

export function apiModelOptionLabel(model: ApiModel, t: TFunction, options?: ModelLabelOptions): string {
  const name =
    model.display_name && model.display_name !== model.model_name
      ? `${model.display_name} · ${model.model_name}`
      : model.model_name;
  const defaultLabelKey = options?.defaultLabelKey ?? "common.default";
  const markers = [
    model.is_default ? t(defaultLabelKey) : "",
    model.enabled ? "" : t("common.disabled"),
  ].filter(Boolean);
  return markers.length ? `${name} (${markers.join(", ")})` : name;
}

export function apiModelFullLabel(
  model: ApiModel,
  provider: ApiProvider | undefined,
  t: TFunction,
  options?: ModelLabelOptions,
): string {
  return `${providerDisplayName(provider, t)} · ${apiModelOptionLabel(model, t, options)}`;
}

export function personaModelLabel(
  persona: { api_model_id?: string | null; backing_model?: string | null },
  modelById: Map<string, ApiModel>,
  providerById: Map<string, ApiProvider>,
  t: TFunction,
): string {
  if (persona.api_model_id) {
    const model = modelById.get(persona.api_model_id);
    if (model) return apiModelFullLabel(model, providerById.get(model.api_provider_id), t);
  }
  return persona.backing_model?.trim() || t("room.defaultModel");
}

export function renderApiModelOptions(
  models: ApiModel[],
  providerById: Map<string, ApiProvider>,
  t: TFunction,
  options?: ModelLabelOptions,
): ReactNode {
  const groups = new Map<string, ApiModel[]>();
  for (const model of models) {
    groups.set(model.api_provider_id, [...(groups.get(model.api_provider_id) ?? []), model]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) =>
      providerDisplayName(providerById.get(left), t).localeCompare(providerDisplayName(providerById.get(right), t)),
    )
    .map(([providerId, group]) => (
      <optgroup key={providerId} label={providerDisplayName(providerById.get(providerId), t)}>
        {group
          .slice()
          .sort(
            (left, right) =>
              Number(right.is_default) - Number(left.is_default) ||
              left.display_name.localeCompare(right.display_name),
          )
          .map((model) => (
            <option key={model.id} value={model.id} disabled={!model.enabled}>
              {apiModelOptionLabel(model, t, options)}
            </option>
          ))}
      </optgroup>
    ));
}
