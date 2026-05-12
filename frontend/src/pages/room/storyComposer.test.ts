import { describe, expect, it } from "vitest";
import { buildStoryComposerContext, inferDirectorTargetPersona } from "./storyComposer";
import type { PersonaInstance, WorldCharacter, WorldSceneMember } from "../../types";

const character = (patch: Partial<WorldCharacter> & Pick<WorldCharacter, "id" | "kind" | "name">) =>
  ({
    world_id: "world-1",
    identity: "",
    brief: "",
    persona_template_id: null,
    persona_template_version: null,
    backing_overrides: {},
    color: "#14b8a6",
    icon: "Sparkles",
    core_identity: "",
    skills_text: "",
    goals_text: "",
    status: "active",
    config: {},
    created_at: "",
    updated_at: "",
    ...patch
  }) as WorldCharacter;

const member = (
  patch: Partial<WorldSceneMember> & Pick<WorldSceneMember, "world_character_id">
) =>
  ({
    scene_id: "scene-1",
    role_in_scene: "",
    speak_as_user: false,
    entered_at_message_id: null,
    exited_at_message_id: null,
    joined_at: "",
    ...patch
  }) as WorldSceneMember;

const persona = (
  patch: Partial<PersonaInstance> & Pick<PersonaInstance, "id" | "name" | "world_character_id">
) =>
  ({
    room_id: "scene-1",
    template_id: "template-1",
    template_version: 1,
    schema_version: 1,
    status: "published",
    position: 0,
    kind: "discussant",
    identity: "",
    description: "",
    system_prompt: "",
    temperature: 0.4,
    talkativeness: 1,
    color: "#3b82f6",
    icon: "Sparkles",
    config: {},
    tags: [],
    ...patch
  }) as PersonaInstance;

describe("buildStoryComposerContext", () => {
  it("returns null for ordinary discussion rooms", () => {
    expect(buildStoryComposerContext(null, [], [], [])).toBeNull();
  });

  it("only exposes speak_as_user user characters that are still present", () => {
    const characters = [
      character({ id: "user-playable", kind: "user", name: "柳青" }),
      character({ id: "user-locked", kind: "user", name: "旁观者" }),
      character({ id: "user-exited", kind: "user", name: "离场者" })
    ];
    const members = [
      member({ world_character_id: "user-playable", speak_as_user: true }),
      member({ world_character_id: "user-locked", speak_as_user: false }),
      member({
        world_character_id: "user-exited",
        speak_as_user: true,
        exited_at_message_id: "exit-1"
      })
    ];

    const context = buildStoryComposerContext("world-1", characters, members, []);

    expect(context?.playableUserCharacters.map((item) => item.id)).toEqual(["user-playable"]);
  });

  it("only exposes present AI personas as director targets", () => {
    const characters = [
      character({ id: "ai-present", kind: "ai", name: "苏离" }),
      character({ id: "ai-exited", kind: "ai", name: "阿照" })
    ];
    const members = [
      member({ world_character_id: "ai-present" }),
      member({ world_character_id: "ai-exited", exited_at_message_id: "exit-1" })
    ];
    const personas = [
      persona({ id: "persona-present", name: "苏离", world_character_id: "ai-present" }),
      persona({ id: "persona-exited", name: "阿照", world_character_id: "ai-exited" }),
      persona({ id: "persona-unbound", name: "旁白", world_character_id: null })
    ];

    const context = buildStoryComposerContext("world-1", characters, members, personas);

    expect(context?.presentAiPersonas.map((item) => item.id)).toEqual(["persona-present"]);
  });
});

describe("inferDirectorTargetPersona", () => {
  const targets = [
    persona({ id: "su-li", name: "苏离", identity: "剑客", world_character_id: "ai-1" }),
    persona({ id: "a-zhao", name: "阿照", identity: "医者", world_character_id: "ai-2" })
  ];

  it("uses an explicit selected target first", () => {
    expect(inferDirectorTargetPersona("让苏离回应", "a-zhao", targets)?.id).toBe("a-zhao");
  });

  it("can infer a target from the local director instruction", () => {
    expect(inferDirectorTargetPersona("让苏离回应阿照刚才的问题。", null, targets)?.id).toBe("su-li");
  });
});
