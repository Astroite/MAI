import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Globe, MessagesSquare, Moon, PanelsTopLeft, Settings, Sun, Workflow, Wrench } from "lucide-react";
import { useUIStore } from "../store";
import { LanguageToggle, useI18n } from "../i18n";

type RailEntry = {
  to: string;
  label: string;
  icon: ReactNode;
  matchPrefixes: string[];
};

export function AppRail() {
  const { t } = useI18n();
  const dark = useUIStore((state) => state.dark);
  const toggleDark = useUIStore((state) => state.toggleDark);
  const { pathname } = useLocation();

  const entries: RailEntry[] = [
    {
      to: "/dashboard",
      label: t("nav.rail.rooms"),
      icon: <MessagesSquare size={18} />,
      matchPrefixes: ["/dashboard", "/rooms/", "/"]
    },
    {
      to: "/worlds",
      label: t("nav.rail.worlds"),
      icon: <Globe size={18} />,
      matchPrefixes: ["/worlds"]
    },
    {
      to: "/templates/personas",
      label: t("nav.rail.templates"),
      icon: <Workflow size={18} />,
      matchPrefixes: ["/templates/"]
    },
    {
      to: "/tools",
      label: t("nav.rail.tools"),
      icon: <Wrench size={18} />,
      matchPrefixes: ["/tools"]
    },
    {
      to: "/settings",
      label: t("nav.rail.settings"),
      icon: <Settings size={18} />,
      matchPrefixes: ["/settings"]
    }
  ];

  return (
    <aside
      aria-label="Primary navigation"
      className="relative z-30 flex h-[100dvh] w-16 flex-shrink-0 flex-col items-stretch border-r border-border/80 bg-panel max-md:w-12"
    >
      <div className="flex h-14 items-center justify-center border-b border-border/80">
        <NavLink
          to="/dashboard"
          className="grid h-10 w-10 place-items-center rounded-md bg-brand text-sm font-bold text-white shadow-card max-md:h-8 max-md:w-8"
          title="MAI"
          aria-label="MAI"
        >
          M
        </NavLink>
      </div>
      <nav className="flex flex-1 flex-col items-center gap-1 px-1 py-3">
        {entries.map((entry) => (
          <RailItem
            key={entry.to}
            to={entry.to}
            label={entry.label}
            icon={entry.icon}
            active={isActive(pathname, entry.matchPrefixes)}
          />
        ))}
      </nav>
      <div className="flex flex-col items-center gap-1 border-t border-border/80 px-1 py-3">
        <button
          className="grid h-10 w-10 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-text"
          type="button"
          onClick={toggleDark}
          title={t("theme.toggle")}
          aria-label={t("theme.toggle")}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <LanguageToggle compact />
        <NavLink
          to="/settings"
          className="grid h-10 w-10 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-text"
          title={t("nav.rail.account")}
          aria-label={t("nav.rail.account")}
        >
          <PanelsTopLeft size={18} />
        </NavLink>
      </div>
    </aside>
  );
}

function isActive(pathname: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (prefix === "/") {
      if (pathname === "/") return true;
      continue;
    }
    if (prefix.endsWith("/")) {
      if (pathname.startsWith(prefix)) return true;
    } else if (pathname === prefix) {
      return true;
    }
  }
  return false;
}

function RailItem({
  to,
  icon,
  label,
  active
}: {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition ${
        active ? "bg-brand/10 text-brand" : "text-muted hover:bg-surface hover:text-text"
      }`}
      title={label}
      aria-label={label}
    >
      {active && (
        <span aria-hidden="true" className="absolute left-0 top-1.5 h-7 w-0.5 rounded-r-full bg-brand" />
      )}
      {icon}
    </NavLink>
  );
}
