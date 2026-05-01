import type { DebateFormat, Decision, Message, Persona, PhaseTemplate, Recipe, Room, RoomState } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; database: string; mock_llm: boolean }>("/health"),
  rooms: () => request<Room[]>("/rooms"),
  roomState: (roomId: string) => request<RoomState>(`/rooms/${roomId}/state`),
  createRoom: (body: { title: string; recipe_id?: string | null; format_id?: string | null; persona_ids: string[] }) =>
    request<RoomState>("/rooms", { method: "POST", body: JSON.stringify(body) }),
  createSubroom: (
    roomId: string,
    body: { title: string; recipe_id?: string | null; format_id?: string | null; persona_ids: string[] }
  ) => request<RoomState>(`/rooms/${roomId}/subrooms`, { method: "POST", body: JSON.stringify(body) }),
  personas: (kind?: string) => request<Persona[]>(`/templates/personas${kind ? `?kind=${kind}` : ""}`),
  phases: () => request<PhaseTemplate[]>("/templates/phases"),
  formats: () => request<DebateFormat[]>("/templates/formats"),
  recipes: () => request<Recipe[]>("/templates/recipes"),
  createRecipe: (body: unknown) => request<Recipe>("/templates/recipes", { method: "POST", body: JSON.stringify(body) }),
  createPhase: (body: unknown) => request<PhaseTemplate>("/templates/phases", { method: "POST", body: JSON.stringify(body) }),
  appendMessage: (roomId: string, content: string) =>
    request<Message>(`/rooms/${roomId}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  verdict: (
    roomId: string,
    content: string,
    is_locked: boolean,
    extra?: { dead_end?: boolean; revoke_message_id?: string }
  ) =>
    request<Message>(`/rooms/${roomId}/verdicts`, {
      method: "POST",
      body: JSON.stringify({ content, is_locked, ...(extra ?? {}) })
    }),
  masquerade: (roomId: string, persona_id: string, content: string) =>
    request<Message>(`/rooms/${roomId}/masquerade`, {
      method: "POST",
      body: JSON.stringify({ persona_id, content })
    }),
  reveal: (roomId: string, messageId: string) =>
    request<Message>(`/rooms/${roomId}/messages/${messageId}/reveal`, { method: "POST" }),
  runTurn: (roomId: string, speaker_persona_id?: string) =>
    request<Message[]>(`/rooms/${roomId}/turn`, {
      method: "POST",
      body: JSON.stringify({ speaker_persona_id })
    }),
  nextPhase: (roomId: string, target_position?: number) =>
    request<RoomState>(`/rooms/${roomId}/phase/next`, {
      method: "POST",
      body: JSON.stringify({ target_position })
    }),
  continuePhase: (roomId: string) => request<RoomState>(`/rooms/${roomId}/phase/continue`, { method: "POST" }),
  askFacilitator: (roomId: string) => request<RoomState>(`/rooms/${roomId}/facilitator`, { method: "POST" }),
  insertPhase: (roomId: string, phase_template_id: string) =>
    request<RoomState>(`/rooms/${roomId}/phase/insert`, {
      method: "POST",
      body: JSON.stringify({ phase_template_id })
    }),
  lockDecision: (roomId: string, decisionId: string, is_locked: boolean) =>
    request<Decision>(`/rooms/${roomId}/decisions/${decisionId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_locked })
    }),
  freeze: (roomId: string) => request<RoomState>(`/rooms/${roomId}/freeze`, { method: "POST" }),
  unfreeze: (roomId: string) => request<RoomState>(`/rooms/${roomId}/unfreeze`, { method: "POST" }),
  updateLimits: (roomId: string, body: unknown) =>
    request(`/rooms/${roomId}/limits`, { method: "PATCH", body: JSON.stringify(body) }),
  upload: async (roomId: string, file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<{ id: string }>(`/upload?room_id=${roomId}`, { method: "POST", body: data });
  },
  messageFromUpload: (roomId: string, upload_id: string) =>
    request<Message>(`/rooms/${roomId}/messages/from_upload`, {
      method: "POST",
      body: JSON.stringify({ upload_id })
    }),
  mergeBack: (
    roomId: string,
    body: {
      conclusion: string;
      key_reasoning: string[];
      rejected_alternatives?: Array<Record<string, unknown>>;
      unresolved?: string[];
      artifacts_ref?: Record<string, unknown>;
    }
  ) => request<{ status: string; merge_back_id: string }>(`/rooms/${roomId}/merge_back`, { method: "POST", body: JSON.stringify(body) })
};

export { API_BASE };
