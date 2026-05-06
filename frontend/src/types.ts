export type PersonaKind = "discussant" | "scribe" | "facilitator";

export interface PersonaTemplate {
  id: string;
  version: number;
  kind: PersonaKind;
  name: string;
  description: string;
  backing_model: string;
  api_provider_id?: string | null;
  system_prompt: string;
  temperature: number;
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
  position: number;
  kind: PersonaKind;
  name: string;
  description: string;
  backing_model: string;
  api_provider_id?: string | null;
  system_prompt: string;
  temperature: number;
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

export interface AppSettings {
  default_backing_model?: string | null;
  default_api_provider_id?: string | null;
  setup_complete: boolean;
  updated_at?: string | null;
}

export interface PhaseTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
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
  name: string;
  description: string;
  phase_sequence: FormatPhaseSlot[];
  tags: string[];
  is_builtin: boolean;
}

export interface Recipe {
  id: string;
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
  title: string;
  status: "active" | "frozen" | "archived";
  format_id?: string | null;
  created_at: string;
}

export interface Runtime {
  room_id: string;
  current_phase_instance_id?: string | null;
  frozen: boolean;
  token_counter_total: number;
  cost_counter_usd: number;
  auto_transition: boolean;
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

export interface Message {
  id: string;
  room_id: string;
  phase_instance_id?: string | null;
  parent_message_id?: string | null;
  message_type: string;
  author_persona_id?: string | null;
  author_model?: string | null;
  author_actual: "ai" | "user" | "user_as_judge" | "user_as_persona" | "system";
  user_masquerade_persona_id?: string | null;
  user_masquerade_name?: string | null;
  visibility: string;
  visibility_to_models: boolean;
  content: string;
  truncated_reason?: string | null;
  user_revealed_at?: string | null;
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
  in_flight_partial: InFlightPartial[];
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
}
