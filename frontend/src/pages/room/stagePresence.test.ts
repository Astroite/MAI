import { describe, expect, it } from "vitest";
import { buildStagePresenceView } from "./stagePresence";
import type {
  PersonaInstance,
  Room,
  SceneContext,
  WorldCharacter,
  WorldDetail,
  WorldSceneMember
} from "../../types";

const room = (patch: Partial<Room> = {}) =>
  ({
    id: "scene-1",
    title: "雪夜客栈",
    background: "",
    status: "active",
    world_id: "world-1",
    scene_index: 2,
    in_world_time_start: "",
    in_world_time_end: "",
    in_world_duration_hint: "",
    sealed_at: null,
    created_at: "",
    ...patch
  }) as Room;

const world = (characters: WorldCharacter[], patch: Partial<WorldDetail> = {}) =>
  ({
    id: "world-1",
    owner_user_id: null,
    name: "江湖旧盟",
    synopsis: "",
    setting: "",
    calendar_hint: "",
    cover_color: "#0f766e",
    cover_icon: "BookOpen",
    status: "active",
    config: {},
    created_at: "",
    updated_at: "",
    characters,
    ...patch
  }) as WorldDetail;

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

const member = (patch: Partial<WorldSceneMember> & Pick<WorldSceneMember, "world_character_id">) =>
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

const context = (patch: Partial<SceneContext> = {}) =>
  ({
    room_id: "scene-1",
    world: {
      id: "world-1",
      name: "江湖旧盟",
      summary: "",
      background: "",
      current_date_label: "永熙三年冬",
      current_location: "边城客栈",
      current_arc: {},
      rules: [],
      taboos: [],
      plot_hooks: []
    },
    scene: {
      id: "scene-1",
      scene_index: 2,
      title: "雪夜客栈",
      background: "",
      in_world_time_start: "",
      in_world_time_end: "",
      in_world_duration_hint: "",
      sealed: false,
      frozen: false
    },
    timeline: [],
    stage_characters: [],
    speaker: null,
    ...patch
  }) as SceneContext;

describe("buildStagePresenceView", () => {
  it("shows world, act, time, and location from Scene Context", () => {
    const view = buildStagePresenceView({
      room: room(),
      context: context(),
      world: world([])
    });

    expect(view.worldName).toBe("江湖旧盟");
    expect(view.sceneIndex).toBe(2);
    expect(view.sceneTitle).toBe("雪夜客栈");
    expect(view.currentTime).toBe("永熙三年冬");
    expect(view.currentLocation).toBe("边城客栈");
  });

  it("splits present and exited characters and preserves AI/user flags", () => {
    const ai = character({ id: "ai-1", kind: "ai", name: "苏离" });
    const user = character({ id: "user-1", kind: "user", name: "柳青" });
    const view = buildStagePresenceView({
      room: room(),
      world: world([ai, user]),
      personas: [persona({ id: "persona-ai", name: "苏离", world_character_id: "ai-1" })],
      context: context({
        stage_characters: [
          {
            world_character_id: "ai-1",
            persona_instance_id: "persona-ai",
            name: "苏离",
            kind: "ai",
            role_in_scene: "守夜",
            speak_as_user: false,
            entry_order: 0,
            joined_at: "",
            entered_at_message_id: null,
            exited_at_message_id: null,
            is_present: true,
            can_speak: true,
            can_user_speak_as: false
          },
          {
            world_character_id: "user-1",
            persona_instance_id: null,
            name: "柳青",
            kind: "user",
            role_in_scene: "访客",
            speak_as_user: true,
            entry_order: 1,
            joined_at: "",
            entered_at_message_id: null,
            exited_at_message_id: "exit-1",
            is_present: false,
            can_speak: false,
            can_user_speak_as: false
          }
        ]
      })
    });

    expect(view.presentCharacters.map((item) => item.name)).toEqual(["苏离"]);
    expect(view.exitedCharacters.map((item) => item.name)).toEqual(["柳青"]);
    expect(view.presentCharacters[0].kind).toBe("ai");
    expect(view.exitedCharacters[0].kind).toBe("user");
  });

  it("marks playable user characters from fallback roster data", () => {
    const user = character({ id: "user-1", kind: "user", name: "柳青" });
    const view = buildStagePresenceView({
      room: room(),
      world: world([user]),
      members: [member({ world_character_id: "user-1", speak_as_user: true })]
    });

    expect(view.fromFallback).toBe(true);
    expect(view.presentCharacters[0].canUserSpeakAs).toBe(true);
    expect(view.presentCharacters[0].canSpeak).toBe(false);
  });

  it("handles empty rosters", () => {
    const view = buildStagePresenceView({
      room: room(),
      context: context(),
      world: world([])
    });

    expect(view.characters).toEqual([]);
    expect(view.presentCharacters).toEqual([]);
    expect(view.exitedCharacters).toEqual([]);
  });
});
