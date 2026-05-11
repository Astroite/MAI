import { NavLink } from "react-router-dom";
import type { ApiModel, ApiProvider } from "../../../types";
import { useI18n } from "../../../i18n";
import { renderApiModelOptions } from "../../../utils/modelLabels";

export function ModelSelector({
  name,
  value,
  models,
  providerById,
  onChange
}: {
  name: string;
  value: string;
  models: ApiModel[];
  providerById: Map<string, ApiProvider>;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="label">{t("common.model")}</span>
      <select
        name={name}
        className="input mt-1 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("room.defaultModel")}</option>
        {renderApiModelOptions(models, providerById, t)}
      </select>
      {models.length === 0 && (
        <p className="mt-1 text-xs text-muted">
          {t("templates.noModelGoAdd")}{" "}
          <NavLink className="text-brand underline" to="/templates/api">
            {t("common.add")}
          </NavLink>
        </p>
      )}
    </label>
  );
}
