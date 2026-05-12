import type {
  PersonaInstance,
  Room,
  SceneContext,
  WorldCharacter,
  WorldDetail,
  WorldSceneMember
} from "../../types";

export interface StagePresenceCharacter {
  id: string;
  personaInstanceId: string | null;
  name: string;
  identity: string;
  brief: string;
  coreIdentity: string;
  kind: "ai" | "user";
  color: string;
  icon: string;
  roleInScene: string;
  isPresent: boolean;
  canSpeak: boolean;
  canUserSpeakAs: boolean;
  enteredAtMessageId: string | null;
  exitedAtMessageId: string | null;
  entryOrder: number;
}

export interface StagePresenceView {
  worldId: string | null;
  worldName: string;
  sceneId: string;
  sceneIndex: number | null;
  sceneTitle: string;
  currentTime: string;
  currentLocation: string;
  sealed: boolean;
  frozen: boolean;
  fromFallback: boolean;
  characters: StagePresenceCharacter[];
  presentCharacters: StagePresenceCharacter[];
  exitedCharacters: StagePresenceCharacter[];
}

export function buildStagePresenceView(input: {
  room: Room;
  context?: SceneContext | null;
  world?: WorldDetail | null;
  members?: WorldSceneMember[] | null;
  personas?: PersonaInstance[];
}): StagePresenceView {
  const { room, context, world } = input;
  const personas = input.personas ?? [];
  const characters = world?.characters ?? [];
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const personaByCharacterId = new Map(
    personas
      .filter((persona) => persona.world_character_id)
      .map((persona) => [persona.world_character_id!, persona])
  );
  const worldBible = readWorldBible(world);
  const stageCharacters =
    context?.stage_characters.map((entry) => {
      const character = characterById.get(entry.world_character_id);
      const persona = entry.persona_instance_id
        ? personas.find((item) => item.id === entry.persona_instance_id) ?? null
        : personaByCharacterId.get(entry.world_character_id) ?? null;
      return enrichStageCharacter({
        id: entry.world_character_id,
        persona,
        character,
        name: entry.name,
        kind: entry.kind,
        roleInScene: entry.role_in_scene,
        isPresent: entry.is_present,
        canSpeak: entry.can_speak,
        canUserSpeakAs: entry.can_user_speak_as,
        enteredAtMessageId: entry.entered_at_message_id,
        exitedAtMessageId: entry.exited_at_message_id,
        entryOrder: entry.entry_order
      });
    }) ?? buildFallbackCharacters(input.members ?? [], characterById, personaByCharacterId);

  const sortedCharacters = [...stageCharacters].sort((left, right) => {
    if (left.isPresent !== right.isPresent) return left.isPresent ? -1 : 1;
    return left.entryOrder - right.entryOrder || left.name.localeCompare(right.name);
  });

  return {
    worldId: context?.world.id ?? world?.id ?? room.world_id ?? null,
    worldName: context?.world.name ?? world?.name ?? "",
    sceneId: context?.scene.id ?? room.id,
    sceneIndex: context?.scene.scene_index ?? room.scene_index ?? null,
    sceneTitle: context?.scene.title ?? room.title,
    currentTime:
      context?.world.current_date_label ||
      room.in_world_time_start ||
      worldBible.current_date_label ||
      "",
    currentLocation: context?.world.current_location || worldBible.current_location || "",
    sealed: context?.scene.sealed ?? Boolean(room.sealed_at),
    frozen: context?.scene.frozen ?? room.status === "frozen",
    fromFallback: !context,
    characters: sortedCharacters,
    presentCharacters: sortedCharacters.filter((character) => character.isPresent),
    exitedCharacters: sortedCharacters.filter((character) => !character.isPresent)
  };
}

function buildFallbackCharacters(
  members: WorldSceneMember[],
  characterById: Map<string, WorldCharacter>,
  personaByCharacterId: Map<string, PersonaInstance>
): StagePresenceCharacter[] {
  return members.map((member, index) => {
    const character = characterById.get(member.world_character_id);
    const persona = personaByCharacterId.get(member.world_character_id) ?? null;
    const isPresent = member.exited_at_message_id === null;
    return enrichStageCharacter({
      id: member.world_character_id,
      persona,
      character,
      name: character?.name ?? persona?.name ?? member.world_character_id,
      kind: character?.kind ?? "ai",
      roleInScene: member.role_in_scene,
      isPresent,
      canSpeak: isPresent && character?.kind === "ai" && Boolean(persona),
      canUserSpeakAs: isPresent && character?.kind === "user" && member.speak_as_user === true,
      enteredAtMessageId: member.entered_at_message_id,
      exitedAtMessageId: member.exited_at_message_id,
      entryOrder: index
    });
  });
}

function enrichStageCharacter(input: {
  id: string;
  persona: PersonaInstance | null | undefined;
  character: WorldCharacter | null | undefined;
  name: string;
  kind: "ai" | "user";
  roleInScene: string;
  isPresent: boolean;
  canSpeak: boolean;
  canUserSpeakAs: boolean;
  enteredAtMessageId: string | null;
  exitedAtMessageId: string | null;
  entryOrder: number;
}): StagePresenceCharacter {
  const { character, persona } = input;
  return {
    id: input.id,
    personaInstanceId: persona?.id ?? null,
    name: input.name || character?.name || persona?.name || input.id,
    identity: character?.identity || persona?.identity || "",
    brief: character?.brief || persona?.description || "",
    coreIdentity: character?.core_identity || "",
    kind: input.kind,
    color: character?.color || persona?.color || "#64748b",
    icon: character?.icon || persona?.icon || "Sparkles",
    roleInScene: input.roleInScene,
    isPresent: input.isPresent,
    canSpeak: input.canSpeak,
    canUserSpeakAs: input.canUserSpeakAs,
    enteredAtMessageId: input.enteredAtMessageId,
    exitedAtMessageId: input.exitedAtMessageId,
    entryOrder: input.entryOrder
  };
}

function readWorldBible(world?: WorldDetail | null): {
  current_date_label: string;
  current_location: string;
} {
  const config = world?.config ?? {};
  const bible = config.world_bible;
  if (!bible || typeof bible !== "object" || Array.isArray(bible)) {
    return { current_date_label: "", current_location: "" };
  }
  const record = bible as Record<string, unknown>;
  return {
    current_date_label:
      typeof record.current_date_label === "string" ? record.current_date_label : "",
    current_location: typeof record.current_location === "string" ? record.current_location : ""
  };
}
