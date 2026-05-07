import type {
  ApiProvider,
  ApiProviderDetail,
  ApiProviderTestResult,
  ApiModel,
  AppSettings,
  DebateFormat,
  Decision,
  Message,
  PersonaInstance,
  PersonaTemplate,
  PhaseTemplate,
  Recipe,
  Room,
  RoomState
} from "./types";

declare global {
  interface Window {
    /** Injected by the Tauri shell at startup to point the SPA at the
     *  ephemeral-port sidecar backend. Falls back to VITE_API_BASE / "/api"
     *  for the dev server / single-process serve cases. */
    __MAI_API_BASE__?: string;
  }
}

const API_BASE =
  (typeof window !== "undefined" && window.__MAI_API_BASE__) ||
  import.meta.env.VITE_API_BASE ||
  "/api";

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
  health: () =>
    request<{ status: string; database: string; setup_complete: boolean }>("/health"),
  appSettings: () => request<AppSettings>("/settings"),
  updateAppSettings: (body: {
    default_backing_model?: string | null;
    default_api_provider_id?: string | null;
    default_api_model_id?: string | null;
  }) =>
    request<AppSettings>("/settings", { method: "PATCH", body: JSON.stringify(body) }),
  testApiProvider: (providerId: string, model?: string) => {
    const qs = model ? `?model=${encodeURIComponent(model)}` : "";
    return request<ApiProviderTestResult>(
      `/templates/api-providers/${providerId}/test${qs}`,
      { method: "POST" }
    );
  },
  rooms: () => request<Room[]>("/rooms"),
  roomState: (roomId: string) => request<RoomState>(`/rooms/${roomId}/state`),
  deleteRoom: (roomId: string) =>
    request<{ status: string; room_id: string }>(`/rooms/${roomId}`, { method: "DELETE" }),
  createRoom: (body: { title: string; recipe_id?: string | null; format_id?: string | null; persona_ids: string[] }) =>
    request<RoomState>("/rooms", { method: "POST", body: JSON.stringify(body) }),
  createSubroom: (
    roomId: string,
    body: { title: string; recipe_id?: string | null; format_id?: string | null; persona_ids: string[] }
  ) => request<RoomState>(`/rooms/${roomId}/subrooms`, { method: "POST", body: JSON.stringify(body) }),
  personaTemplates: (kind?: string, builtin?: boolean) => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (builtin !== undefined) params.set("builtin", String(builtin));
    const qs = params.toString();
    return request<PersonaTemplate[]>(`/templates/personas${qs ? `?${qs}` : ""}`);
  },
  createPersonaTemplate: (body: unknown) =>
    request<PersonaTemplate>("/templates/personas", { method: "POST", body: JSON.stringify(body) }),
  updatePersonaTemplate: (templateId: string, body: unknown) =>
    request<PersonaTemplate>(`/templates/personas/${templateId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicatePersonaTemplate: (templateId: string) =>
    request<PersonaTemplate>(`/templates/personas/${templateId}/duplicate`, { method: "POST" }),
  deletePersonaTemplate: (templateId: string) =>
    request<{ status: string }>(`/templates/personas/${templateId}`, { method: "DELETE" }),
  addRoomPersonaInstances: (roomId: string, template_ids: string[]) =>
    request<RoomState>(`/rooms/${roomId}/personas`, {
      method: "POST",
      body: JSON.stringify({ template_ids })
    }),
  updatePersonaInstance: (roomId: string, instanceId: string, body: unknown) =>
    request<PersonaInstance>(`/rooms/${roomId}/persona-instances/${instanceId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  removePersonaInstance: (roomId: string, instanceId: string) =>
    request<{ status: string }>(`/rooms/${roomId}/persona-instances/${instanceId}`, { method: "DELETE" }),
  apiProviders: () => request<ApiProvider[]>("/templates/api-providers"),
  apiProviderDetail: (providerId: string) =>
    request<ApiProviderDetail>(`/templates/api-providers/${providerId}`),
  createApiProvider: (body: {
    name: string;
    vendor?: string;
    provider_slug: string;
    api_key: string;
    api_base?: string | null;
  }) =>
    request<ApiProviderDetail>("/templates/api-providers", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateApiProvider: (
    providerId: string,
    body: { name?: string; vendor?: string; provider_slug?: string; api_key?: string; api_base?: string | null }
  ) =>
    request<ApiProviderDetail>(`/templates/api-providers/${providerId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteApiProvider: (providerId: string) =>
    request<{ status: string }>(`/templates/api-providers/${providerId}`, { method: "DELETE" }),
  apiModels: (providerId?: string, enabled?: boolean) => {
    const params = new URLSearchParams();
    if (providerId) params.set("provider_id", providerId);
    if (enabled !== undefined) params.set("enabled", String(enabled));
    const qs = params.toString();
    return request<ApiModel[]>(`/templates/api-models${qs ? `?${qs}` : ""}`);
  },
  createApiModel: (body: {
    api_provider_id: string;
    display_name?: string;
    model_name: string;
    enabled?: boolean;
    is_default?: boolean;
    context_window?: number | null;
    tags?: string[];
  }) =>
    request<ApiModel>("/templates/api-models", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateApiModel: (
    modelId: string,
    body: {
      api_provider_id?: string;
      display_name?: string;
      model_name?: string;
      enabled?: boolean;
      is_default?: boolean;
      context_window?: number | null;
      tags?: string[];
    }
  ) =>
    request<ApiModel>(`/templates/api-models/${modelId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteApiModel: (modelId: string) =>
    request<{ status: string }>(`/templates/api-models/${modelId}`, { method: "DELETE" }),
  testApiModel: (modelId: string) =>
    request<ApiProviderTestResult>(`/templates/api-models/${modelId}/test`, { method: "POST" }),
  phases: (builtin?: boolean) =>
    request<PhaseTemplate[]>(`/templates/phases${builtin !== undefined ? `?builtin=${String(builtin)}` : ""}`),
  formats: (builtin?: boolean) =>
    request<DebateFormat[]>(`/templates/formats${builtin !== undefined ? `?builtin=${String(builtin)}` : ""}`),
  createFormat: (body: unknown) => request<DebateFormat>("/templates/formats", { method: "POST", body: JSON.stringify(body) }),
  updateFormat: (formatId: string, body: unknown) =>
    request<DebateFormat>(`/templates/formats/${formatId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicateFormat: (formatId: string) =>
    request<DebateFormat>(`/templates/formats/${formatId}/duplicate`, { method: "POST" }),
  deleteFormat: (formatId: string) =>
    request<{ status: string }>(`/templates/formats/${formatId}`, { method: "DELETE" }),
  recipes: (builtin?: boolean) =>
    request<Recipe[]>(`/templates/recipes${builtin !== undefined ? `?builtin=${String(builtin)}` : ""}`),
  createRecipe: (body: unknown) => request<Recipe>("/templates/recipes", { method: "POST", body: JSON.stringify(body) }),
  updateRecipe: (recipeId: string, body: unknown) =>
    request<Recipe>(`/templates/recipes/${recipeId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicateRecipe: (recipeId: string) =>
    request<Recipe>(`/templates/recipes/${recipeId}/duplicate`, { method: "POST" }),
  deleteRecipe: (recipeId: string) =>
    request<{ status: string }>(`/templates/recipes/${recipeId}`, { method: "DELETE" }),
  createPhase: (body: unknown) => request<PhaseTemplate>("/templates/phases", { method: "POST", body: JSON.stringify(body) }),
  updatePhase: (phaseId: string, body: unknown) =>
    request<PhaseTemplate>(`/templates/phases/${phaseId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicatePhase: (phaseId: string) =>
    request<PhaseTemplate>(`/templates/phases/${phaseId}/duplicate`, { method: "POST" }),
  deletePhase: (phaseId: string) =>
    request<{ status: string }>(`/templates/phases/${phaseId}`, { method: "DELETE" }),
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
  masquerade: (roomId: string, display_name: string, content: string, persona_id?: string | null) =>
    request<Message>(`/rooms/${roomId}/masquerade`, {
      method: "POST",
      body: JSON.stringify({ persona_id: persona_id || null, display_name, content })
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
  extendPhase: (roomId: string) => request<RoomState>(`/rooms/${roomId}/phase/extend`, { method: "POST" }),
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
