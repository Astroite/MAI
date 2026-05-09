import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, MessagesSquare, Plus, RefreshCw, Settings2, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

type StepDef = {
  key: string;
  done: boolean;
  label: string;
  icon: LucideIcon;
  action: { to: string; label: string };
};

function GettingStartedCard({
  apiReady,
  hasPersonas
}: {
  apiReady: boolean;
  hasPersonas: boolean;
}) {
  const { t } = useI18n();
  const steps: StepDef[] = [
    {
      key: "api",
      done: apiReady,
      icon: Settings2,
      label: t("dashboard.gettingStarted.step.api"),
      action: { to: "/settings", label: t("dashboard.gettingStarted.go.api") }
    },
    {
      key: "personas",
      done: hasPersonas,
      icon: UsersRound,
      label: t("dashboard.gettingStarted.step.personas"),
      action: { to: "/templates/personas", label: t("dashboard.gettingStarted.go.personas") }
    },
    {
      key: "room",
      done: false,
      icon: MessagesSquare,
      label: t("dashboard.gettingStarted.step.room"),
      action: { to: "/dashboard/new", label: t("dashboard.newRoom") }
    }
  ];
  const nextKey = steps.find((step) => !step.done)?.key;

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold">{t("dashboard.gettingStarted.title")}</h2>
          <p className="text-sm text-muted">{t("dashboard.gettingStarted.subtitle")}</p>
        </div>

        <ol
          // 3 equal-width nodes on md+, vertical stack on mobile. Connectors
          // are flex items rendered between the nodes — they hide on mobile
          // because the layout switches to a column.
          className="flex items-stretch justify-center gap-3 max-md:flex-col"
        >
          {steps.map((step, index) => (
            <Fragment key={step.key}>
              <StepNode step={step} index={index} isNext={step.key === nextKey} />
              {index < steps.length - 1 && <StepConnector done={step.done} />}
            </Fragment>
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepNode({
  step,
  index,
  isNext
}: {
  step: StepDef;
  index: number;
  isNext: boolean;
}) {
  const { t } = useI18n();
  // Three visual states: done (green), next (brand-highlighted, primary CTA),
  // upcoming (muted). The whole card is the same shape; only color shifts so
  // the row reads as a continuous progress strip rather than three islands.
  const state = step.done ? "done" : isNext ? "next" : "upcoming";
  const tone = {
    done: "border-emerald-500/40 bg-emerald-500/5",
    next: "border-brand bg-brand/5 shadow-card",
    upcoming: "border-border bg-surface"
  }[state];
  const Icon = step.icon;

  return (
    <li
      className={`flex w-full max-w-[16rem] flex-1 flex-col items-center gap-3 rounded-lg border px-4 py-5 text-center transition ${tone}`}
    >
      <div className="relative">
        {/* Numbered badge with the step's icon inside; flips to a check when done. */}
        <span
          className={`grid h-12 w-12 place-items-center rounded-full ${
            state === "done"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : state === "next"
                ? "bg-brand/15 text-brand"
                : "bg-panel text-muted"
          }`}
        >
          {state === "done" ? <Check size={22} /> : <Icon size={22} />}
        </span>
        <span
          aria-hidden
          className={`absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-panel text-[10px] font-semibold ${
            state === "done"
              ? "bg-emerald-500 text-white"
              : state === "next"
                ? "bg-brand text-white"
                : "bg-surface text-muted"
          }`}
        >
          {index + 1}
        </span>
      </div>

      <div className="min-h-[2.5rem] text-sm font-medium leading-snug text-text">
        {step.label}
      </div>

      {step.done ? (
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {t("common.done")}
        </span>
      ) : (
        <Link
          to={step.action.to}
          className={`btn h-8 px-3 text-xs ${state === "next" ? "btn-primary" : ""}`}
        >
          {step.key === "room" && <Plus size={12} />}
          {step.action.label}
        </Link>
      )}
    </li>
  );
}

function StepConnector({ done }: { done: boolean }) {
  // Small "rail" between nodes. Filled when the previous step is done so the
  // strip reads left-to-right like a progress bar.
  return (
    <li
      aria-hidden
      className="flex flex-1 items-center max-md:hidden"
      style={{ maxWidth: "3rem" }}
    >
      <span
        className={`h-[2px] w-full rounded-full ${done ? "bg-emerald-500/50" : "bg-border"}`}
      />
    </li>
  );
}
