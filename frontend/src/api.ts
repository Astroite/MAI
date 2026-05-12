import type {
  ApiProvider,
  ApiProviderDetail,
  ApiProviderTestResult,
  ApiModel,
  AppSettings,
  DebateFormat,
  DebateFormatCreate,
  DebateFormatUpdate,
  Decision,
  LimitUpdate,
  Message,
  PersonaInstance,
  PersonaInstanceUpdate,
  PersonaTemplate,
  PersonaTemplateCreate,
  PersonaTemplateUpdate,
  PhaseTemplate,
  PhaseTemplateCreate,
  PhaseTemplateUpdate,
  Recipe,
  RecipeCreate,
  RecipeUpdate,
  Room,
  RoomState,
  Runtime,
  Scenario,
  SceneCreateBody,
  SceneContext,
  SceneEnterBody,
  SceneExitBody,
  SceneSealDraft,
  SceneSealDraftUpdateBody,
  SceneSealResult,
  SceneTimelineEntry,
  TemplateDraft,
  ToolInvocation,
  ToolSchema,
  ToolServer,
  UserMessageType,
  World,
  WorldCharacter,
  WorldCharacterCreateBody,
  WorldCharacterMemory,
  WorldCharacterMemoryCreateBody,
  WorldCharacterMemoryUpdateBody,
  WorldCharacterRelation,
  WorldCharacterRelationUpdateBody,
  WorldCharacterRelationUpsertBody,
  WorldCharacterUpdateBody,
  WorldCreateBody,
  WorldBible,
  WorldBibleUpdateBody,
  WorldDetail,
  WorldSceneMember,
  WorldState,
  WorldSummary,
  WorldTimelineEvent,
  WorldTimelineEventCreateBody,
  WorldTimelineEventUpdateBody,
  WorldUpdateBody
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
    request<{
      status: string;
      database: string;
      setup_complete: boolean;
      setup_steps?: { providers: boolean; models: boolean; default_model: boolean };
    }>("/health"),
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
  createRoom: (body: {
    title: string;
    background?: string;
    recipe_id?: string | null;
    format_id?: string | null;
    persona_ids: string[];
  }) =>
    request<RoomState>("/rooms", { method: "POST", body: JSON.stringify(body) }),
  updateRoomBackground: (roomId: string, background: string) =>
    request<Room>(`/rooms/${roomId}/background`, {
      method: "PATCH",
      body: JSON.stringify({ background })
    }),
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
  createPersonaTemplate: (body: PersonaTemplateCreate) =>
    request<PersonaTemplate>("/templates/personas", { method: "POST", body: JSON.stringify(body) }),
  updatePersonaTemplate: (templateId: string, body: PersonaTemplateUpdate) =>
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
  updatePersonaInstance: (roomId: string, instanceId: string, body: PersonaInstanceUpdate) =>
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
    body: { name?: string; provider_slug?: string; api_key?: string; api_base?: string | null }
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
  scenarios: () => request<Scenario[]>("/scenarios"),
  tools: () => request<ToolSchema[]>("/tools"),
  toolServers: () => request<ToolServer[]>("/tools/mcp-servers"),
  createToolServer: (body: {
    name: string;
    description?: string;
    transport?: "streamable_http" | "sse";
    url: string;
    enabled?: boolean;
    allow_write?: boolean;
  }) => request<ToolServer>("/tools/mcp-servers", { method: "POST", body: JSON.stringify(body) }),
  updateToolServer: (serverId: string, body: Partial<ToolServer>) =>
    request<ToolServer>(`/tools/mcp-servers/${serverId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteToolServer: (serverId: string) =>
    request<{ status: string }>(`/tools/mcp-servers/${serverId}`, { method: "DELETE" }),
  syncToolServer: (serverId: string) =>
    request<ToolServer>(`/tools/mcp-servers/${serverId}/sync`, { method: "POST" }),
  executeTool: (
    roomId: string,
    body: { tool_name: string; arguments?: Record<string, unknown>; parent_message_id?: string | null; allow_write?: boolean }
  ) => request<ToolInvocation>(`/rooms/${roomId}/tools/execute`, { method: "POST", body: JSON.stringify(body) }),
  templateDraft: (body: { kind: "persona" | "phase" | "recipe"; prompt: string }) =>
    request<TemplateDraft>("/assistants/template-draft", { method: "POST", body: JSON.stringify(body) }),
  phases: (builtin?: boolean) =>
    request<PhaseTemplate[]>(`/templates/phases${builtin !== undefined ? `?builtin=${String(builtin)}` : ""}`),
  formats: (builtin?: boolean) =>
    request<DebateFormat[]>(`/templates/formats${builtin !== undefined ? `?builtin=${String(builtin)}` : ""}`),
  createFormat: (body: DebateFormatCreate) => request<DebateFormat>("/templates/formats", { method: "POST", body: JSON.stringify(body) }),
  updateFormat: (formatId: string, body: DebateFormatUpdate) =>
    request<DebateFormat>(`/templates/formats/${formatId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicateFormat: (formatId: string) =>
    request<DebateFormat>(`/templates/formats/${formatId}/duplicate`, { method: "POST" }),
  deleteFormat: (formatId: string) =>
    request<{ status: string }>(`/templates/formats/${formatId}`, { method: "DELETE" }),
  recipes: (builtin?: boolean) =>
    request<Recipe[]>(`/templates/recipes${builtin !== undefined ? `?builtin=${String(builtin)}` : ""}`),
  createRecipe: (body: RecipeCreate) => request<Recipe>("/templates/recipes", { method: "POST", body: JSON.stringify(body) }),
  updateRecipe: (recipeId: string, body: RecipeUpdate) =>
    request<Recipe>(`/templates/recipes/${recipeId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicateRecipe: (recipeId: string) =>
    request<Recipe>(`/templates/recipes/${recipeId}/duplicate`, { method: "POST" }),
  deleteRecipe: (recipeId: string) =>
    request<{ status: string }>(`/templates/recipes/${recipeId}`, { method: "DELETE" }),
  createPhase: (body: PhaseTemplateCreate) => request<PhaseTemplate>("/templates/phases", { method: "POST", body: JSON.stringify(body) }),
  updatePhase: (phaseId: string, body: PhaseTemplateUpdate) =>
    request<PhaseTemplate>(`/templates/phases/${phaseId}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicatePhase: (phaseId: string) =>
    request<PhaseTemplate>(`/templates/phases/${phaseId}/duplicate`, { method: "POST" }),
  deletePhase: (phaseId: string) =>
    request<{ status: string }>(`/templates/phases/${phaseId}`, { method: "DELETE" }),
  appendMessage: (
    roomId: string,
    content: string,
    options?: { message_type?: UserMessageType; as_character_id?: string | null }
  ) =>
    request<Message>(`/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, ...(options ?? {}) })
    }),
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
  runTurn: (roomId: string, speaker_persona_id?: string, director_instruction?: string) =>
    request<Message[]>(`/rooms/${roomId}/turn`, {
      method: "POST",
      body: JSON.stringify({ speaker_persona_id, director_instruction })
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
  pause: (roomId: string) => request<RoomState>(`/rooms/${roomId}/pause`, { method: "POST" }),
  unfreeze: (roomId: string) => request<RoomState>(`/rooms/${roomId}/unfreeze`, { method: "POST" }),
  resumeAutodrive: (roomId: string) =>
    request<{ status: "scheduled" | "skipped"; reason?: string | null; active: boolean }>(
      `/rooms/${roomId}/autodrive/resume`,
      { method: "POST" }
    ),
  updateLimits: (roomId: string, body: LimitUpdate) =>
    request<Runtime>(`/rooms/${roomId}/limits`, { method: "PATCH", body: JSON.stringify(body) }),
  upload: async (roomId: string, file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<{ id: string }>(`/upload?room_id=${roomId}`, { method: "POST", body: data });
  },
  exportRoom: async (roomId: string): Promise<{ blob: Blob; filename: string }> => {
    const resp = await fetch(`${API_BASE}/rooms/${roomId}/export?format=md`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || resp.statusText);
    }
    const blob = await resp.blob();
    const cd = resp.headers.get("content-disposition") || "";
    let filename = `room-${roomId}.md`;
    const utf8Match = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match) {
      try {
        filename = decodeURIComponent(utf8Match[1]);
      } catch {
        /* fall through to ASCII fallback */
      }
    }
    if (!utf8Match) {
      const ascii = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (ascii) filename = ascii[1];
    }
    return { blob, filename };
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
  ) => request<{ status: string; merge_back_id: string }>(`/rooms/${roomId}/merge_back`, { method: "POST", body: JSON.stringify(body) }),

  // --- Story World ---------------------------------------------------------
  worlds: () => request<WorldSummary[]>("/worlds"),
  world: (worldId: string) => request<WorldDetail>(`/worlds/${worldId}`),
  worldState: (worldId: string) => request<WorldState>(`/worlds/${worldId}/state`),
  createWorld: (body: WorldCreateBody) =>
    request<WorldDetail>("/worlds", { method: "POST", body: JSON.stringify(body) }),
  updateWorld: (worldId: string, body: WorldUpdateBody) =>
    request<WorldDetail>(`/worlds/${worldId}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateWorldBible: (worldId: string, body: WorldBibleUpdateBody) =>
    request<WorldBible>(`/worlds/${worldId}/bible`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteWorld: (worldId: string) =>
    request<{ status: string }>(`/worlds/${worldId}`, { method: "DELETE" }),

  worldCharacter: (worldId: string, characterId: string) =>
    request<WorldCharacter>(`/worlds/${worldId}/characters/${characterId}`),
  createWorldCharacter: (worldId: string, body: WorldCharacterCreateBody) =>
    request<WorldCharacter>(`/worlds/${worldId}/characters`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateWorldCharacter: (worldId: string, characterId: string, body: WorldCharacterUpdateBody) =>
    request<WorldCharacter>(`/worlds/${worldId}/characters/${characterId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteWorldCharacter: (worldId: string, characterId: string) =>
    request<WorldCharacter>(`/worlds/${worldId}/characters/${characterId}`, { method: "DELETE" }),

  characterMemories: (worldId: string, characterId: string) =>
    request<WorldCharacterMemory[]>(
      `/worlds/${worldId}/characters/${characterId}/memories`
    ),
  createCharacterMemory: (
    worldId: string,
    characterId: string,
    body: WorldCharacterMemoryCreateBody
  ) =>
    request<WorldCharacterMemory>(
      `/worlds/${worldId}/characters/${characterId}/memories`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  updateCharacterMemory: (
    worldId: string,
    characterId: string,
    memoryId: string,
    body: WorldCharacterMemoryUpdateBody
  ) =>
    request<WorldCharacterMemory>(
      `/worlds/${worldId}/characters/${characterId}/memories/${memoryId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  deleteCharacterMemory: (worldId: string, characterId: string, memoryId: string) =>
    request<{ status: string }>(
      `/worlds/${worldId}/characters/${characterId}/memories/${memoryId}`,
      { method: "DELETE" }
    ),

  characterRelations: (worldId: string, characterId: string) =>
    request<WorldCharacterRelation[]>(
      `/worlds/${worldId}/characters/${characterId}/relations`
    ),
  upsertCharacterRelation: (
    worldId: string,
    characterId: string,
    targetCharacterId: string,
    body: WorldCharacterRelationUpsertBody
  ) =>
    request<WorldCharacterRelation>(
      `/worlds/${worldId}/characters/${characterId}/relations/${targetCharacterId}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  patchCharacterRelation: (
    worldId: string,
    characterId: string,
    targetCharacterId: string,
    body: WorldCharacterRelationUpdateBody
  ) =>
    request<WorldCharacterRelation>(
      `/worlds/${worldId}/characters/${characterId}/relations/${targetCharacterId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  deleteCharacterRelation: (worldId: string, characterId: string, targetCharacterId: string) =>
    request<{ status: string }>(
      `/worlds/${worldId}/characters/${characterId}/relations/${targetCharacterId}`,
      { method: "DELETE" }
    ),

  worldTimeline: (worldId: string) =>
    request<SceneTimelineEntry[]>(`/worlds/${worldId}/timeline`),
  worldTimelineEvents: (worldId: string) =>
    request<WorldTimelineEvent[]>(`/worlds/${worldId}/timeline-events`),
  createWorldTimelineEvent: (worldId: string, body: WorldTimelineEventCreateBody) =>
    request<WorldTimelineEvent>(`/worlds/${worldId}/timeline-events`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateWorldTimelineEvent: (
    worldId: string,
    eventId: string,
    body: WorldTimelineEventUpdateBody
  ) =>
    request<WorldTimelineEvent>(`/worlds/${worldId}/timeline-events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteWorldTimelineEvent: (worldId: string, eventId: string) =>
    request<{ status: string }>(`/worlds/${worldId}/timeline-events/${eventId}`, {
      method: "DELETE"
    }),
  createScene: (worldId: string, body: SceneCreateBody) =>
    request<RoomState>(`/worlds/${worldId}/scenes`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  sealScene: (roomId: string) =>
    request<SceneSealDraft>(`/rooms/${roomId}/seal`, { method: "POST" }),
  sealDrafts: (roomId: string) =>
    request<SceneSealDraft[]>(`/rooms/${roomId}/seal-drafts`),
  createSealDraft: (roomId: string) =>
    request<SceneSealDraft>(`/rooms/${roomId}/seal-drafts`, { method: "POST" }),
  updateSealDraft: (roomId: string, draftId: string, body: SceneSealDraftUpdateBody) =>
    request<SceneSealDraft>(`/rooms/${roomId}/seal-drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  retrySealDraft: (roomId: string, draftId: string) =>
    request<SceneSealDraft>(`/rooms/${roomId}/seal-drafts/${draftId}/retry`, {
      method: "POST"
    }),
  commitSealDraft: (roomId: string, draftId: string) =>
    request<SceneSealResult>(`/rooms/${roomId}/seal-drafts/${draftId}/commit`, {
      method: "POST"
    }),
  sceneMembers: (roomId: string) =>
    request<WorldSceneMember[]>(`/rooms/${roomId}/scene/members`),
  sceneContext: (roomId: string, speaker_persona_id?: string | null) => {
    const suffix = speaker_persona_id
      ? `?speaker_persona_id=${encodeURIComponent(speaker_persona_id)}`
      : "";
    return request<SceneContext>(`/rooms/${roomId}/scene/context${suffix}`);
  },
  sceneEnter: (roomId: string, body: SceneEnterBody) =>
    request<WorldSceneMember>(`/rooms/${roomId}/scene/enter`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  sceneExit: (roomId: string, body: SceneExitBody) =>
    request<WorldSceneMember>(`/rooms/${roomId}/scene/exit`, {
      method: "POST",
      body: JSON.stringify(body)
    })
};

export { API_BASE };
