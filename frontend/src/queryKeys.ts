export const queryKeys = {
  health: ["health"] as const,
  appSettings: ["app-settings"] as const,
  rooms: ["rooms"] as const,
  room: (roomId: string | null | undefined) => ["room", roomId] as const,
  worlds: ["worlds"] as const,
  apiProviders: ["api-providers"] as const,
  apiModels: ["api-models"] as const,
  personaTemplates: {
    all: ["persona-templates"] as const,
    editable: ["persona-templates", "editable"] as const,
    builtin: ["persona-templates", "builtin"] as const,
    discussant: ["persona-templates", "discussant"] as const,
    discussantEditable: ["persona-templates", "discussant", "editable"] as const,
    discussantUser: ["persona-templates", "discussant", "user"] as const,
  },
  phases: {
    all: ["phases"] as const,
    editable: ["phases", "editable"] as const,
    builtin: ["phases", "builtin"] as const,
  },
  formats: {
    all: ["formats"] as const,
    editable: ["formats", "editable"] as const,
    builtin: ["formats", "builtin"] as const,
  },
  recipes: {
    all: ["recipes"] as const,
    editable: ["recipes", "editable"] as const,
    builtin: ["recipes", "builtin"] as const,
  },
  scenarios: ["scenarios"] as const,
  tools: ["tools"] as const,
  toolServers: ["tool-servers"] as const,
  world: (worldId: string | null | undefined) => ["world", worldId] as const,
  worldTimeline: (worldId: string | null | undefined) => ["world-timeline", worldId] as const,
  sceneMembers: (roomId: string | null | undefined) => ["scene-members", roomId] as const,
  characterMemories: (worldId: string, characterId: string) =>
    ["character-memories", worldId, characterId] as const,
  characterRelations: (worldId: string, characterId: string) =>
    ["character-relations", worldId, characterId] as const,
};
