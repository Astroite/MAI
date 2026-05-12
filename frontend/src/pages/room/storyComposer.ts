import type { PersonaInstance, WorldCharacter, WorldSceneMember } from "../../types";

export type StoryComposerMode = "narration" | "act_as" | "director";

export interface StoryComposerContext {
  worldId: string;
  playableUserCharacters: WorldCharacter[];
  presentAiPersonas: PersonaInstance[];
}

export function buildStoryComposerContext(
  worldId: string | null,
  characters: WorldCharacter[] | undefined,
  members: WorldSceneMember[] | undefined,
  personas: PersonaInstance[]
): StoryComposerContext | null {
  if (!worldId || !characters || !members) return null;
  const activeMemberByCharacterId = new Map(
    members
      .filter((member) => member.exited_at_message_id === null)
      .map((member) => [member.world_character_id, member])
  );
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const playableUserCharacters = characters.filter((character) => {
    const member = activeMemberByCharacterId.get(character.id);
    return character.kind === "user" && member?.speak_as_user === true;
  });
  const presentAiPersonas = personas.filter((persona) => {
    if (persona.kind !== "discussant" || !persona.world_character_id) return false;
    if ((persona.config?.auto_reply_enabled ?? true) === false) return false;
    const character = characterById.get(persona.world_character_id);
    return character?.kind === "ai" && activeMemberByCharacterId.has(character.id);
  });
  return { worldId, playableUserCharacters, presentAiPersonas };
}

export function inferDirectorTargetPersona(
  content: string,
  selectedPersonaId: string | null,
  presentAiPersonas: PersonaInstance[]
): PersonaInstance | null {
  if (selectedPersonaId) {
    return presentAiPersonas.find((persona) => persona.id === selectedPersonaId) ?? null;
  }
  const normalized = content.trim().toLowerCase();
  if (!normalized) return null;
  return (
    presentAiPersonas.find((persona) => {
      const name = persona.name.toLowerCase();
      const identity = (persona.identity || "").toLowerCase();
      return normalized.includes(name) || (identity.length > 0 && normalized.includes(identity));
    }) ?? null
  );
}

export function directorInstructionForTurn(content: string): string | undefined {
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
