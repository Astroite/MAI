import { useEffect } from "react";
import type { ReactNode } from "react";
import { NavLink, Route, Routes, useMatch } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Moon, PanelsTopLeft, Settings, Sun, Workflow } from "lucide-react";
import { api } from "./api";
import { useUIStore } from "./store";
import { DashboardPage } from "./pages/DashboardPage";
import { RoomPage } from "./pages/RoomPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const dark = useUIStore((state) => state.dark);
  const toggleDark = useUIStore((state) => state.toggleDark);
  // The room view is its own three-column shell with its own left nav, so we
  // suppress the global top header there to give the chat the full viewport.
  const inRoomView = useMatch({ path: "/rooms/:roomId/*", end: false });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  if (inRoomView) {
    return (
      <div className="min-h-screen bg-surface text-text">
        <SetupBanner />
        <Routes>
          <Route path="/rooms/:roomId" element={<RoomPage />} />
          <Route path="/rooms/:roomId/sub/:subId" element={<RoomPage />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-text">
      <SetupBanner />
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
          <Route path="/templates/:kind" element={<TemplatesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function SetupBanner() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30000 });
  if (!health.data || health.data.setup_complete) return null;
  return (
    <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
      <div className="mx-auto flex max-w-[1500px] items-center gap-2">
        <AlertTriangle size={14} />
        <span>尚未配置默认 API。人设调用会失败——</span>
        <NavLink to="/settings" className="underline">
          前往设置页面
        </NavLink>
        <span>添加 API 提供商并设为默认。</span>
      </div>
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
