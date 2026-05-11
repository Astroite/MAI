import { NavLink, useParams } from "react-router-dom";
import { Cog, Layers, ScrollText, UsersRound, Workflow } from "lucide-react";
import { useI18n } from "../../i18n";
import { PersonasTab } from "./PersonasTab";
import { PhasesTab } from "./PhasesTab";
import { FormatsTab } from "./FormatsTab";
import { RecipesTab } from "./RecipesTab";
import { ProvidersTab } from "./ProvidersTab";

const TAB_ENTRIES = [
  { kind: "personas", labelKey: "templates.personas", icon: UsersRound },
  { kind: "phases", labelKey: "templates.phases", icon: Layers },
  { kind: "formats", labelKey: "templates.formats", icon: Workflow },
  { kind: "recipes", labelKey: "templates.recipes", icon: ScrollText },
  { kind: "api", labelKey: "templates.api", icon: Cog }
] as const;

export function TemplatesLayout() {
  const { kind = "phases" } = useParams();
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <nav
        className="panel mai-scrollbar flex items-center gap-1 overflow-x-auto p-1.5"
        aria-label={t("templates.navAria")}
      >
        {TAB_ENTRIES.map((entry) => {
          const Icon = entry.icon;
          return (
            <NavLink
              key={entry.kind}
              to={`/templates/${entry.kind}`}
              className={({ isActive }) =>
                `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
                  isActive
                    ? "bg-brand text-white shadow-card"
                    : "text-muted hover:bg-surface hover:text-text"
                }`
              }
            >
              <Icon size={14} />
              {t(entry.labelKey)}
            </NavLink>
          );
        })}
      </nav>
      {kind === "personas" && <PersonasTab />}
      {kind === "formats" && <FormatsTab />}
      {kind === "recipes" && <RecipesTab />}
      {kind === "phases" && <PhasesTab />}
      {kind === "api" && <ProvidersTab />}
    </div>
  );
}
