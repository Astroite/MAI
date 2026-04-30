import { useEffect } from "react";
import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Moon, PanelsTopLeft, Settings, Sun, Workflow } from "lucide-react";
import { useUIStore } from "./store";
import { DashboardPage } from "./pages/DashboardPage";
import { RoomPage } from "./pages/RoomPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const dark = useUIStore((state) => state.dark);
  const toggleDark = useUIStore((state) => state.toggleDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="min-h-screen bg-surface text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-panel/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white">M</div>
            <div>
              <div className="text-sm font-semibold">MAI</div>
              <div className="text-xs text-muted">多模型协作讨论平台</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavItem to="/dashboard" icon={<PanelsTopLeft size={16} />} label="房间" />
            <NavItem to="/templates/phases" icon={<Workflow size={16} />} label="模板" />
            <NavItem to="/settings" icon={<Settings size={16} />} label="设置" />
            <button className="btn ml-2 w-9 px-0" onClick={toggleDark} title="切换暗色模式">
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-4">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/rooms/:roomId" element={<RoomPage />} />
          <Route path="/templates/:kind" element={<TemplatesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `btn border-transparent bg-transparent ${isActive ? "border-border bg-surface text-brand" : "text-muted"}`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
