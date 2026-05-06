import { useUIStore } from "../../store";
import type { Persona } from "../../types";

function personaColor(id?: string | null): string {
  if (!id) return "rgb(var(--muted))";
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 52% 48%)`;
}

function personaInitial(name?: string | null): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2);
}

export function MembersSidebar({
  roomId,
  personas
}: {
  roomId: string;
  personas: Persona[];
}) {
  const streaming = useUIStore((state) => state.streaming);
  const activePersonaIds = new Set(
    Object.values(streaming)
      .filter((item) => item.roomId === roomId)
      .map((item) => item.personaId)
  );
  const discussants = personas.filter((p) => p.kind === "discussant");
  const systemPersonas = personas.filter((p) => p.kind !== "discussant");
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-panel">
      <div className="border-b border-border px-3 py-3 text-sm font-semibold">
        成员 · {discussants.length}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {discussants.map((persona) => (
          <PersonaRow key={persona.id} persona={persona} speaking={activePersonaIds.has(persona.id)} />
        ))}
        {systemPersonas.length > 0 && (
          <>
            <div className="mt-4 px-2 text-xs uppercase tracking-wider text-muted">系统角色</div>
            {systemPersonas.map((persona) => (
              <PersonaRow key={persona.id} persona={persona} speaking={false} muted />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function PersonaRow({
  persona,
  speaking,
  muted = false
}: {
  persona: Persona;
  speaking: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md px-2 py-2 text-sm ${
        speaking ? "bg-brand/10" : "hover:bg-surface"
      } ${muted ? "opacity-70" : ""}`}
    >
      <div className="relative">
        <div
          className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ background: personaColor(persona.id) }}
          aria-hidden="true"
        >
          {personaInitial(persona.name)}
        </div>
        {speaking && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-brand"
            style={{ animation: "pulse-ring 1.4s ease-out infinite" }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{persona.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted">{persona.backing_model}</div>
        {speaking && <div className="mt-0.5 text-xs text-brand">正在发言</div>}
      </div>
    </div>
  );
}
