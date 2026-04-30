export type PersonaKind = "discussant" | "scribe" | "facilitator";

export interface Persona {
  id: string;
  kind: PersonaKind;
  name: string;
  description: string;
  backing_model: string;
  system_prompt: string;
  temperature: number;
  tags: string[];
  is_builtin: boolean;
}

export interface PhaseTemplate {
  id: string;
  name: string;
  description: string;
  allowed_speakers: Record<string, unknown>;
  ordering_rule: { type: string };
  exit_conditions: Array<Record<string, unknown>>;
  role_constraints: string;
  prompt_template: string;
  tags: string[];
  is_builtin: boolean;
}

export interface DebateFormat {
  id: string;
  name: string;
  description: string;
  phase_sequence: Array<{ phase_template_id: string; phase_template_version: number }>;
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
  message_type: string;
  author_persona_id?: string | null;
  author_model?: string | null;
  author_actual: "ai" | "user" | "user_as_judge" | "user_as_persona" | "system";
  user_masquerade_persona_id?: string | null;
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

export interface RoomState {
  room: Room;
  runtime: Runtime;
  personas: Persona[];
  phase_plan: PhasePlan[];
  current_phase?: PhaseInstance | null;
  messages: Message[];
  scribe_state: {
    current_state: ScribeState;
  };
  facilitator_signals: FacilitatorSignal[];
}

export interface StreamingEvent {
  type: string;
  room_id: string;
  message_id?: string;
  persona_id?: string;
  chunk_text?: string;
  chunk_index?: number;
}

