import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SceneStagePanel } from "./SceneStagePanel";
import type { SceneSpeakerContext } from "../../types";
import type { StagePresenceCharacter, StagePresenceView } from "./stagePresence";

vi.mock("../../i18n", () => {
  const labels: Record<string, string> = {
    "common.loading": "Loading",
    "room.panel.stage": "Stage",
    "room.scene.act": "Act {n}",
    "room.scene.sealed": "Sealed",
    "room.stage.ai": "AI",
    "room.stage.backToWorld": "Back to World",
    "room.stage.canSpeak": "Can speak",
    "room.stage.cannotSpeak": "Cannot speak",
    "room.stage.contextFallback": "Stage context fallback",
    "room.stage.coreIdentity": "Identity cue",
    "room.stage.exited": "Exited",
    "room.stage.exitedCount": "Exited {count}",
    "room.stage.exitedStatus": "Exited",
    "room.stage.frozen": "Paused",
    "room.stage.loading": "Loading stage",
    "room.stage.locationUnknown": "Location unknown",
    "room.stage.memoryCues": "Memory cues",
    "room.stage.noCoreIdentity": "No identity",
    "room.stage.noExited": "No exited",
    "room.stage.noMemoryCues": "No memories",
    "room.stage.noPresent": "No present",
    "room.stage.noRelationshipCues": "No relationships",
    "room.stage.noRole": "No role",
    "room.stage.playable": "Playable",
    "room.stage.presence": "Presence",
    "room.stage.present": "Present",
    "room.stage.presentCount": "Present {count}",
    "room.stage.presentStatus": "Present",
    "room.stage.relationshipCues": "Relationship cues",
    "room.stage.role": "Stage role",
    "room.stage.speaker": "Speech access",
    "room.stage.timeUnknown": "Time unknown",
    "room.stage.unknownWorld": "Unknown world",
    "room.stage.user": "User",
    "room.stage.visibleMessages": "Visible messages",
    "room.stage.visibleMessagesCount": "{count} messages",
    "room.stage.visibleMessagesUnavailable": "No preview"
  };
  return {
    useI18n: () => ({
      locale: "en-US",
      setLocale: vi.fn(),
      display: (_kind: string, value?: string | null) => value ?? "",
      formatRelativeTime: () => "",
      t: (key: string, params?: Record<string, string | number | null | undefined>) => {
        const template = labels[key] ?? key;
        return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));
      }
    })
  };
});

const presentCharacter: StagePresenceCharacter = {
  id: "ai-1",
  personaInstanceId: "persona-ai",
  name: "Su Li",
  identity: "Wandering swordsman",
  brief: "Keeps watch by the window.",
  coreIdentity: "Quiet, loyal, and reluctant to explain old wounds.",
  kind: "ai",
  color: "#14b8a6",
  icon: "Sparkles",
  roleInScene: "Night watch",
  isPresent: true,
  canSpeak: true,
  canUserSpeakAs: false,
  enteredAtMessageId: null,
  exitedAtMessageId: null,
  entryOrder: 0
};

const exitedCharacter: StagePresenceCharacter = {
  id: "user-1",
  personaInstanceId: null,
  name: "Offstage courier",
  identity: "Messenger",
  brief: "Left through the snow.",
  coreIdentity: "",
  kind: "user",
  color: "#3b82f6",
  icon: "Compass",
  roleInScene: "Messenger",
  isPresent: false,
  canSpeak: false,
  canUserSpeakAs: false,
  enteredAtMessageId: null,
  exitedAtMessageId: "exit-1",
  entryOrder: 1
};

const view: StagePresenceView = {
  worldId: null,
  worldName: "Old Alliance",
  sceneId: "scene-1",
  sceneIndex: 2,
  sceneTitle: "Snowbound Inn",
  currentTime: "Third winter night",
  currentLocation: "Border inn",
  sealed: false,
  frozen: false,
  fromFallback: false,
  characters: [presentCharacter, exitedCharacter],
  presentCharacters: [presentCharacter],
  exitedCharacters: [exitedCharacter]
};

const speakerContext: SceneSpeakerContext = {
  persona_instance_id: "persona-ai",
  world_character_id: "ai-1",
  name: "Su Li",
  memory_cues: [
    memoryCue("m1", "Memory one"),
    memoryCue("m2", "Memory two"),
    memoryCue("m3", "Memory three"),
    memoryCue("m4", "Memory four")
  ],
  relationship_cues: [
    relationshipCue("r1", "Liu Qing", "Owes a favor"),
    relationshipCue("r2", "Innkeeper", "Distrusts the rumor"),
    relationshipCue("r3", "Old master", "Still fears the vow"),
    relationshipCue("r4", "Bandit", "Should stay hidden")
  ],
  visibility: {
    transcript_from_message_id: null,
    transcript_to_message_id: null,
    visible_message_count: 7,
    notes: []
  }
};

describe("SceneStagePanel", () => {
  it("renders compact stage metadata and the present roster", () => {
    const html = renderPanel();

    expect(html).toContain("Stage");
    expect(html).toContain("Old Alliance");
    expect(html).toContain("Act 2");
    expect(html).toContain("Snowbound Inn");
    expect(html).toContain("Border inn");
    expect(html).toContain("Su Li");
    expect(html).toContain("AI");
    expect(html).toContain("Can speak");
  });

  it("keeps exited characters collapsed by default while showing the count", () => {
    const html = renderPanel();

    expect(html).toContain("Exited 1");
    expect(html).not.toContain("Offstage courier");
  });

  it("renders selected character cues and caps cue lists at three items", () => {
    const html = renderPanel();

    expect(html).toContain("7 messages");
    expect(html).toContain("Memory one");
    expect(html).toContain("Memory three");
    expect(html).not.toContain("Memory four");
    expect(html).toContain("Liu Qing: Owes a favor");
    expect(html).not.toContain("Bandit: Should stay hidden");
  });
});

function renderPanel() {
  return renderToStaticMarkup(
    <SceneStagePanel
      view={view}
      selectedStageCharacterId="ai-1"
      speakerContext={speakerContext}
      stageLoading={false}
      stageCueLoading={false}
      stageContextError={false}
      onSelectStageCharacter={vi.fn()}
    />
  );
}

function memoryCue(id: string, content: string) {
  return {
    id,
    world_character_id: "ai-1",
    source_scene_id: "scene-0",
    seal_draft_id: null,
    scene_index_at_write: 1,
    in_world_time_at_event: "",
    kind: "episode" as const,
    target_character_id: null,
    content,
    salience: 0.8,
    last_used_scene_index: null,
    source: "manual" as const,
    created_at: ""
  };
}

function relationshipCue(id: string, toName: string, notes: string) {
  return {
    id,
    from_character_id: "ai-1",
    to_character_id: id,
    to_character_name: toName,
    label: "",
    sentiment: 0,
    notes,
    last_updated_scene_id: null,
    last_updated_seal_draft_id: null,
    source: "manual" as const,
    updated_at: ""
  };
}
