export type PersonaKind = "discussant" | "scribe" | "facilitator";
export type TemplateStatus = "draft" | "published";

export interface PersonaTemplate {
  id: string;
  version: number;
  schema_version: number;
  status: TemplateStatus;
  kind: PersonaKind;
  name: string;
  identity: string;
  description: string;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  backing_model?: string | null;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  api_provider_id?: string | null;
  api_model_id?: string | null;
  system_prompt: string;
  temperature: number;
  talkativeness: number;
  color: string;
  icon: string;
  config: Record<string, unknown>;
  tags: string[];
  is_builtin: boolean;
  owner_user_id?: string | null;
  forked_from_id?: string | null;
}

export interface PersonaInstance {
  id: string;
  room_id: string;
  template_id: string;
  template_version: number;
  schema_version: number;
  status: TemplateStatus;
  position: number;
  kind: PersonaKind;
  name: string;
  identity: string;
  description: string;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  backing_model?: string | null;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  api_provider_id?: string | null;
  api_model_id?: string | null;
  system_prompt: string;
  temperature: number;
  talkativeness: number;
  color: string;
  icon: string;
  config: Record<string, unknown>;
  tags: string[];
}

export interface ApiProvider {
  id: string;
  name: string;
  provider_slug: string;
  api_key_preview: string;
  has_api_key: boolean;
  api_base?: string | null;
  last_tested_ok?: boolean | null;
  last_tested_at?: string | null;
  last_tested_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiProviderDetail extends ApiProvider {
  api_key: string;
}

export interface ApiProviderTestResult {
  ok: boolean;
  status_code?: number | null;
  error?: string | null;
  tested_at: string;
}

export interface ApiModel {
  id: string;
  api_provider_id: string;
  display_name: string;
  model_name: string;
  enabled: boolean;
  is_default: boolean;
  context_window?: number | null;
  tags: string[];
  last_tested_ok?: boolean | null;
  last_tested_at?: string | null;
  last_tested_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  /** @deprecated Legacy fallback snapshot. New writes should use default_api_model_id. */
  default_backing_model?: string | null;
  /** @deprecated Legacy fallback snapshot. New writes should use default_api_model_id. */
  default_api_provider_id?: string | null;
  default_api_model_id?: string | null;
  setup_complete: boolean;
  updated_at?: string | null;
}

export interface PhaseTemplate {
  id: string;
  version: number;
  schema_version: number;
  status: TemplateStatus;
  name: string;
  description: string;
  declared_variables: Array<{ name: string; description: string; cardinality: "one" | "many"; required: boolean }>;
  allowed_speakers: Record<string, unknown>;
  ordering_rule: { type: string };
  exit_conditions: Array<Record<string, unknown>>;
  auto_discuss?: boolean;
  role_constraints: string;
  prompt_template: string;
  tags: string[];
  is_builtin: boolean;
}

export interface FormatPhaseSlot {
  phase_template_id: string;
  phase_template_version: number;
  transitions?: Array<Record<string, unknown>>;
}

export interface DebateFormat {
  id: string;
  version: number;
  schema_version: number;
  status: TemplateStatus;
  name: string;
  description: string;
  phase_sequence: FormatPhaseSlot[];
  tags: string[];
  is_builtin: boolean;
}

export interface Recipe {
  id: string;
  version: number;
  schema_version: number;
  status: TemplateStatus;
  name: string;
  description: string;
  persona_ids: string[];
  format_id?: string | null;
  format_version?: number | null;
  initial_settings: Record<string, unknown>;
  tags: string[];
  is_builtin: boolean;
}

export interface Room {
  id: string;
  parent_room_id?: string | null;
  owner_user_id?: string | null;
  title: string;
  background: string;
  status: "active" | "frozen" | "archived";
  recipe_id?: string | null;
  format_id?: string | null;
  format_version?: number | null;
  frozen_at?: string | null;
  // Story World scene fields (non-null world_id marks the room as a scene).
  world_id?: string | null;
  scene_index?: number | null;
  in_world_time_start?: string;
  in_world_time_end?: string;
  in_world_duration_hint?: string;
  sealed_at?: string | null;
  created_at: string;
  // Populated by `GET /rooms` (room list); RoomState's `room` field omits these.
  member_count?: number;
  members?: Array<{ id: string; name: string; identity?: string; color: string; icon: string }>;
  message_count?: number;
  last_activity_at?: string | null;
}

export interface Runtime {
  room_id: string;
  current_phase_instance_id?: string | null;
  frozen: boolean;
  token_counter_total: number;
  cost_counter_usd: number;
  auto_transition: boolean;
  current_user_mode: string;
  current_masquerade_persona_id?: string | null;
  max_message_tokens: number;
  max_room_tokens: number;
  max_phase_rounds: number;
  max_account_daily_tokens: number;
  max_account_monthly_tokens: number;
  phase_exit_suggested: boolean;
  phase_exit_matched_conditions: Array<Record<string, unknown>>;
  phase_exit_suppressed_after_message_id?: string | null;
  consecutive_ai_turns?: number;
  max_consecutive_ai_turns?: number;
  autodrive_active?: boolean;
  current_speakers?: string[];
  phase_extra_rounds?: number;
}

export interface PhasePlan {
  room_id: string;
  position: number;
  phase_template_id: string;
  phase_template_version: number;
  source: string;
  variable_bindings: Record<string, string[]>;
}

export interface PhaseInstance {
  id: string;
  room_id: string;
  plan_position: number;
  phase_template_id: string;
  status: "running" | "completed" | "skipped";
}

export type MessageType =
  | "speech"
  | "question"
  | "answer"
  | "narration"
  | "summary"
  | "verdict"
  | "verdict_revoke"
  | "dead_end"
  | "facilitator_signal"
  | "user_doc"
  | "tool_invocation"
  | "participant.enter"
  | "participant.exit"
  | "masquerade_reveal"
  | "silence"
  | "background_update"
  | "meta";

export type UserMessageType = Extract<MessageType, "speech" | "question" | "answer" | "narration">;

export type AllowedSpeakers =
  | { type: "all" }
  | { type: "variables"; variable_names: string[] }
  | { type: "specific"; persona_ids: string[] };

export type OrderingRule = { type: string } & Record<string, unknown>;
export type ExitCondition = { type: string } & Record<string, unknown>;

export interface FormatPhaseSlotInput {
  phase_template_id: string;
  phase_template_version: number;
  transitions?: Array<Record<string, unknown>>;
}

export interface PersonaTemplateCreate {
  kind?: PersonaKind;
  name: string;
  identity?: string;
  description?: string;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  backing_model?: string;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  api_provider_id?: string | null;
  api_model_id?: string | null;
  system_prompt: string;
  temperature?: number;
  talkativeness?: number;
  color?: string;
  icon?: string;
  config?: Record<string, unknown>;
  tags?: string[];
}

export type PersonaTemplateUpdate = Partial<Omit<PersonaTemplateCreate, "kind">>;

export interface PersonaInstanceUpdate {
  identity?: string;
  description?: string;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  backing_model?: string;
  /** @deprecated Legacy fallback snapshot. New writes should use api_model_id. */
  api_provider_id?: string | null;
  api_model_id?: string | null;
  system_prompt?: string;
  temperature?: number;
  talkativeness?: number;
  color?: string;
  icon?: string;
  config?: Record<string, unknown>;
  tags?: string[];
}

export interface DebateFormatCreate {
  name: string;
  description?: string;
  phase_sequence?: FormatPhaseSlotInput[];
  tags?: string[];
}

export type DebateFormatUpdate = Partial<DebateFormatCreate>;

export interface RecipeCreate {
  name: string;
  description?: string;
  persona_ids?: string[];
  format_id?: string | null;
  format_version?: number | null;
  initial_settings?: Record<string, unknown>;
  tags?: string[];
}

export type RecipeUpdate = Partial<RecipeCreate>;

export interface PhaseTemplateCreate {
  name: string;
  description?: string;
  declared_variables?: Array<{ name: string; description: string; cardinality: "one" | "many"; required: boolean }>;
  allowed_speakers?: AllowedSpeakers;
  ordering_rule?: OrderingRule;
  exit_conditions?: ExitCondition[];
  auto_discuss?: boolean;
  role_constraints?: string;
  prompt_template?: string;
  tags?: string[];
}

export type PhaseTemplateUpdate = Partial<PhaseTemplateCreate>;

export interface ToolSchema {
  name: string;
  display_name: string;
  description: string;
  server_id?: string | null;
  server_name?: string | null;
  source: "builtin" | "mcp";
  input_schema: Record<string, unknown>;
  read_only: boolean;
  enabled: boolean;
}

export interface ToolServer {
  id: string;
  name: string;
  description: string;
  kind: "mcp";
  transport: "streamable_http" | "sse";
  url?: string | null;
  enabled: boolean;
  allow_write: boolean;
  manifest: { tools?: Array<Record<string, unknown>> } & Record<string, unknown>;
  last_synced_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolInvocation {
  id: string;
  room_id: string;
  message_id?: string | null;
  parent_message_id?: string | null;
  server_id?: string | null;
  tool_name: string;
  display_name: string;
  status: "pending" | "success" | "error";
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  prompt: string;
  tags: string[];
  recipe_id?: string | null;
  format_id?: string | null;
}

export interface TemplateDraft {
  kind: "persona" | "phase" | "recipe";
  payload: Record<string, unknown>;
  rationale: string;
}

export interface Message {
  id: string;
  room_id: string;
  phase_instance_id?: string | null;
  parent_message_id?: string | null;
  message_type: MessageType;
  author_persona_id?: string | null;
  author_model?: string | null;
  author_actual: "ai" | "user" | "user_as_judge" | "user_as_persona" | "system";
  user_masquerade_persona_id?: string | null;
  user_masquerade_name?: string | null;
  visibility: string;
  visibility_to_models: boolean;
  content: string;
  content_chunks_count: number;
  truncated_reason?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cost_usd?: number | null;
  user_revealed_at?: string | null;
  tool_invocation?: ToolInvocation | null;
  created_at: string;
}

export interface ScribeState {
  consensus: Array<Record<string, unknown>>;
  disagreements: Array<Record<string, unknown>>;
  open_questions: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  dead_ends: Array<Record<string, unknown>>;
}

export interface FacilitatorSignal {
  id: string;
  room_id: string;
  message_id: string;
  trigger_after_message_id: string;
  signals: Array<{ tag: string; severity: string; reasoning: string; evidence_message_ids: string[] }>;
  overall_health: string;
  pacing_note: string;
  created_at: string;
}

export interface Decision {
  id: string;
  room_id: string;
  scribe_event_message_id: string;
  content: string;
  is_locked: boolean;
  locked_by_message_id?: string | null;
  revoked_by_message_id?: string | null;
  created_at: string;
}

export interface RoomState {
  room: Room;
  runtime: Runtime;
  personas: PersonaInstance[];
  phase_plan: PhasePlan[];
  current_phase?: PhaseInstance | null;
  messages: Message[];
  scribe_state: {
    current_state: ScribeState;
  };
  facilitator_signals: FacilitatorSignal[];
  decisions: Decision[];
  tool_invocations: ToolInvocation[];
  in_flight_partial: InFlightPartial[];
}

export interface LimitUpdate {
  max_message_tokens?: number;
  max_room_tokens?: number;
  max_phase_rounds?: number;
  max_account_daily_tokens?: number;
  max_account_monthly_tokens?: number;
  max_consecutive_ai_turns?: number;
  auto_transition?: boolean;
}

export interface SceneMemoryScribeResult {
  character_id: string;
  character_name: string;
  status: "success" | "skipped" | "failed";
  episodes_count: number;
  impressions_count: number;
  vows_count: number;
  error?: string | null;
}

export interface SceneSealResult {
  scene: Room;
  scribe_results: SceneMemoryScribeResult[];
}

export type SceneSealDraftStatus = "generating" | "ready" | "failed" | "committed" | "discarded";

export interface SealDraftTimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  summary: string;
  dateLabel?: string;
  relatedCharacterIds?: string[];
  confidence?: "low" | "medium" | "high";
  selected: boolean;
}

export interface SealDraftMemoryUpdate {
  id: string;
  characterId: string;
  characterName?: string;
  type: string;
  content: string;
  importance?: "low" | "medium" | "high" | "critical";
  confidence?: "low" | "medium" | "high";
  salience?: number;
  locked?: boolean;
  selected: boolean;
  evidence?: string;
}

export interface SealDraftRelationshipUpdate {
  id: string;
  fromCharacterId: string;
  fromCharacterName?: string;
  toCharacterId: string;
  toCharacterName?: string;
  relationType?: string;
  label: string;
  description: string;
  sentimentDelta?: number;
  intensity?: number;
  trust?: number;
  tension?: number;
  confidence?: "low" | "medium" | "high";
  selected: boolean;
  evidence?: string;
}

export interface SealDraftWarning {
  id: string;
  type: string;
  message: string;
  relatedDraftItemIds?: string[];
  relatedCharacterIds?: string[];
}

export interface SceneSealDraft {
  id: string;
  world_id: string;
  scene_id: string;
  status: SceneSealDraftStatus;
  scene_summary: string;
  title_suggestion: string;
  date_label: string;
  location: string;
  timeline_events: SealDraftTimelineEvent[];
  memory_updates: SealDraftMemoryUpdate[];
  relationship_updates: SealDraftRelationshipUpdate[];
  plot_hook_updates: Array<Record<string, unknown>>;
  world_bible_suggestions: Array<Record<string, unknown>>;
  next_scene_suggestions: Array<Record<string, unknown>>;
  warnings: SealDraftWarning[];
  error: string;
  llm_run_id: string | null;
  retry_of_draft_id: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
  scene: Room | null;
}

export interface SceneSealDraftUpdateBody {
  scene_summary?: string;
  title_suggestion?: string;
  date_label?: string;
  location?: string;
  timeline_events?: SealDraftTimelineEvent[];
  memory_updates?: SealDraftMemoryUpdate[];
  relationship_updates?: SealDraftRelationshipUpdate[];
  plot_hook_updates?: Array<Record<string, unknown>>;
  world_bible_suggestions?: Array<Record<string, unknown>>;
  next_scene_suggestions?: Array<Record<string, unknown>>;
  warnings?: SealDraftWarning[];
  status?: "ready" | "discarded";
}

export interface InFlightPartial {
  message_id: string;
  persona_id: string;
  content: string;
  last_chunk_index: number;
  cumulative_tokens_estimate: number;
}

export interface StreamingEvent {
  type: string;
  room_id: string;
  message_id?: string;
  persona_id?: string;
  chunk_text?: string;
  chunk_index?: number;
  // system.error fields
  kind?: string;
  detail?: string;
  error_class?: string;
  persona_name?: string;
  traceback?: string;
}

// --- Story World ---------------------------------------------------------

export type WorldCharacterKind = "ai" | "user";
export type WorldCharacterStatus = "active" | "retired";
export type WorldStatus = "active" | "archived";

export interface WorldCharacter {
  id: string;
  world_id: string;
  kind: WorldCharacterKind;
  name: string;
  identity: string;
  brief: string;
  persona_template_id: string | null;
  persona_template_version: number | null;
  backing_overrides: Record<string, unknown>;
  color: string;
  icon: string;
  core_identity: string;
  skills_text: string;
  goals_text: string;
  status: WorldCharacterStatus;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface World {
  id: string;
  owner_user_id: string | null;
  name: string;
  synopsis: string;
  setting: string;
  calendar_hint: string;
  cover_color: string;
  cover_icon: string;
  status: WorldStatus;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorldDetail extends World {
  characters: WorldCharacter[];
}

export interface WorldSummary extends World {
  character_count: number;
  scene_count: number;
  last_activity_at: string | null;
}

export interface WorldCreateBody {
  name: string;
  synopsis?: string;
  setting?: string;
  calendar_hint?: string;
  cover_color?: string;
  cover_icon?: string;
  config?: Record<string, unknown>;
}

export interface WorldUpdateBody {
  name?: string;
  synopsis?: string;
  setting?: string;
  calendar_hint?: string;
  cover_color?: string;
  cover_icon?: string;
  status?: WorldStatus;
  config?: Record<string, unknown>;
}

export type TimelineEventType =
  | "history"
  | "scene"
  | "memory"
  | "relationship"
  | "plot_hook"
  | "arc_update"
  | "location_update"
  | "faction_update";

export type TimelineEventSource =
  | "user"
  | "ai_suggested"
  | "seal_draft"
  | "seal_committed"
  | "migration";

export type TimelineEventStatus = "draft" | "committed" | "hidden";

export interface WorldBible {
  summary: string;
  genre: string;
  tone: string;
  era: string;
  current_date_label: string;
  current_location: string;
  background: string;
  history: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  factions: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  taboos: Array<Record<string, unknown>>;
  current_arc: Record<string, unknown> | null;
  plot_hooks: Array<Record<string, unknown>>;
}

export type WorldBibleUpdateBody = Partial<WorldBible>;

export interface WorldTimelineEvent {
  id: string;
  world_id: string;
  type: TimelineEventType;
  title: string;
  summary: string;
  date_label: string;
  order: number;
  source: TimelineEventSource;
  status: TimelineEventStatus;
  scene_id: string | null;
  seal_draft_id: string | null;
  related_character_ids: string[];
  related_location_ids: string[];
  related_faction_ids: string[];
  related_memory_ids: string[];
  related_relationship_ids: string[];
  related_hook_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface WorldTimelineEventCreateBody {
  type?: TimelineEventType;
  title: string;
  summary?: string;
  date_label?: string;
  order?: number | null;
  source?: TimelineEventSource;
  status?: TimelineEventStatus;
  scene_id?: string | null;
  related_character_ids?: string[];
  related_location_ids?: string[];
  related_faction_ids?: string[];
  related_memory_ids?: string[];
  related_relationship_ids?: string[];
  related_hook_ids?: string[];
}

export type WorldTimelineEventUpdateBody = Partial<WorldTimelineEventCreateBody>;

export interface WorldCharacterCreateBody {
  kind: WorldCharacterKind;
  name: string;
  identity?: string;
  brief?: string;
  persona_template_id?: string | null;
  backing_overrides?: Record<string, unknown>;
  color?: string;
  icon?: string;
  core_identity?: string;
  skills_text?: string;
  goals_text?: string;
  config?: Record<string, unknown>;
}

export interface WorldCharacterUpdateBody {
  name?: string;
  identity?: string;
  brief?: string;
  persona_template_id?: string | null;
  backing_overrides?: Record<string, unknown>;
  color?: string;
  icon?: string;
  core_identity?: string;
  skills_text?: string;
  goals_text?: string;
  status?: WorldCharacterStatus;
  config?: Record<string, unknown>;
}

export interface WorldSceneMember {
  scene_id: string;
  world_character_id: string;
  role_in_scene: string;
  speak_as_user: boolean;
  entered_at_message_id: string | null;
  exited_at_message_id: string | null;
  joined_at: string;
}

export interface SceneRosterEntry {
  world_character_id: string;
  role_in_scene?: string;
  speak_as_user?: boolean;
}

export interface SceneCreateBody {
  title: string;
  background?: string;
  members?: SceneRosterEntry[];
  in_world_time_start?: string;
  in_world_time_end?: string;
  in_world_duration_hint?: string;
  format_id?: string | null;
  recipe_id?: string | null;
}

export interface SceneTimelineEntry {
  id: string;
  scene_index: number;
  title: string;
  status: "active" | "frozen" | "archived";
  sealed_at: string | null;
  in_world_time_start: string;
  in_world_time_end: string;
  in_world_duration_hint: string;
  member_count: number;
  message_count: number;
  created_at: string;
}

export interface SceneEnterBody {
  world_character_id: string;
  role_in_scene?: string;
  speak_as_user?: boolean;
  description?: string;
}

export interface SceneExitBody {
  world_character_id: string;
  description?: string;
}

export type WorldCharacterMemoryKind =
  | "episode"
  | "impression"
  | "vow"
  | "fact"
  | "backstory";

export interface WorldCharacterMemory {
  id: string;
  world_character_id: string;
  source_scene_id: string | null;
  seal_draft_id: string | null;
  scene_index_at_write: number | null;
  in_world_time_at_event: string;
  kind: WorldCharacterMemoryKind;
  target_character_id: string | null;
  content: string;
  salience: number;
  last_used_scene_index: number | null;
  created_at: string;
}

export interface WorldCharacterMemoryCreateBody {
  kind?: WorldCharacterMemoryKind;
  content: string;
  salience?: number;
  in_world_time_at_event?: string;
  target_character_id?: string | null;
}

export interface WorldCharacterMemoryUpdateBody {
  kind?: WorldCharacterMemoryKind;
  content?: string;
  salience?: number;
  in_world_time_at_event?: string;
  target_character_id?: string | null;
}

export interface WorldCharacterRelation {
  id: string;
  from_character_id: string;
  to_character_id: string;
  label: string;
  sentiment: number;
  notes: string;
  last_updated_scene_id: string | null;
  last_updated_seal_draft_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorldCharacterRelationUpsertBody {
  label?: string;
  sentiment?: number;
  notes?: string;
}

export interface WorldCharacterRelationUpdateBody {
  label?: string;
  sentiment?: number;
  notes?: string;
}

export interface WorldMemoryOverview {
  id: string;
  character_id: string;
  character_name: string;
  character_identity: string;
  character_color: string;
  character_icon: string;
  kind: WorldCharacterMemoryKind;
  content: string;
  source_scene_id: string | null;
  seal_draft_id: string | null;
  scene_index_at_write: number | null;
  in_world_time_at_event: string;
  salience: number;
  source: "manual" | "seal_committed" | "migration";
  status: "committed";
  locked: boolean;
  created_at: string;
}

export interface WorldRelationshipEdge {
  id: string;
  from_character_id: string;
  from_character_name: string;
  from_character_color: string;
  from_character_icon: string;
  to_character_id: string;
  to_character_name: string;
  to_character_color: string;
  to_character_icon: string;
  label: string;
  sentiment: number;
  notes: string;
  last_updated_scene_id: string | null;
  last_updated_seal_draft_id: string | null;
  source: "manual" | "seal_committed" | "migration";
  status: "committed";
  updated_at: string;
}

export interface WorldState {
  world: WorldDetail;
  bible: WorldBible;
  scenes: SceneTimelineEntry[];
  timeline_events: WorldTimelineEvent[];
  memories: WorldMemoryOverview[];
  relationships: WorldRelationshipEdge[];
  recent_scene: SceneTimelineEntry | null;
  open_scene: SceneTimelineEntry | null;
  unresolved_hooks_count: number;
  recent_relationship_changes_count: number;
}
