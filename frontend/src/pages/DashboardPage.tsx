import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Plus, RefreshCw } from "lucide-react";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { useI18n } from "../i18n";

export function DashboardPage() {
  const { t, display } = useI18n();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30000 });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant", "editable"],
    queryFn: () => api.personaTemplates("discussant", false)
  });

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" type="button" onClick={() => void rooms.refetch()}>
              <RefreshCw size={16} />
              {t("common.refresh")}
            </button>
            <Link className="btn btn-primary px-4" to="/dashboard/new">
              <Plus size={16} />
              {t("dashboard.newRoom")}
            </Link>
          </div>
        </div>
        <div className="panel divide-y divide-border">
          {(rooms.data ?? []).map((room) => (
            <Link
              key={room.id}
              to={`/rooms/${room.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-surface"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`h-8 w-1 flex-shrink-0 rounded-full ${
                    room.status === "frozen" ? "bg-danger" : "bg-brand"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="truncate font-medium">{room.title}</div>
                  <div className="mt-1 text-xs text-muted">
                    {new Date(room.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
              <StatusPill tone={room.status === "frozen" ? "danger" : "brand"} dot>
                {display("roomStatus", room.status)}
              </StatusPill>
            </Link>
          ))}
          {!rooms.data?.length && (
            <GettingStartedCard
              apiReady={Boolean(health.data?.setup_complete)}
              hasPersonas={(personas.data?.length ?? 0) > 0}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function GettingStartedCard({
  apiReady,
  hasPersonas
}: {
  apiReady: boolean;
  hasPersonas: boolean;
}) {
  const { t } = useI18n();
  const steps = [
    {
      key: "api",
      done: apiReady,
      label: t("dashboard.gettingStarted.step.api"),
      action: { to: "/settings", label: t("dashboard.gettingStarted.go.api") }
    },
    {
      key: "personas",
      done: hasPersonas,
      label: t("dashboard.gettingStarted.step.personas"),
      action: { to: "/templates/personas", label: t("dashboard.gettingStarted.go.personas") }
    },
    {
      key: "room",
      done: false,
      label: t("dashboard.gettingStarted.step.room"),
      action: { to: "/dashboard/new", label: t("dashboard.newRoom") }
    }
  ];
  const nextStep = steps.find((step) => !step.done);

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-5 text-center">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t("dashboard.gettingStarted.title")}</h2>
          <p className="text-sm text-muted">{t("dashboard.gettingStarted.subtitle")}</p>
        </div>
        <ol className="space-y-2 text-left text-sm">
          {steps.map((step, index) => {
            const isNext = step === nextStep;
            return (
              <li
                key={step.key}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                  step.done
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                    : isNext
                      ? "border-brand bg-brand/5 text-text"
                      : "border-border bg-surface text-muted"
                }`}
              >
                {step.done ? (
                  <Check size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-xs">
                    {index + 1}
                  </span>
                )}
                <span className={`flex-1 ${step.done ? "line-through opacity-70" : ""}`}>{step.label}</span>
                {step.action && !step.done && (
                  <Link to={step.action.to} className="btn h-7 px-2 text-xs">
                    {step.key === "room" && <Plus size={12} />}
                    {step.action.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
