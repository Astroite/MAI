import type { ExitCondition } from "../../../types";

export function buildExitConditions(options: {
  roundsExit: boolean;
  roundsN: number;
  allSpokenExit: boolean;
  minEach: number;
  allVotedExit: boolean;
  manualExit: boolean;
  tokenBudgetExit: boolean;
  tokenBudget: number;
  facilitatorExit: boolean;
  facilitatorTags: string;
}): ExitCondition[] {
  const conditions: ExitCondition[] = [];
  if (options.roundsExit) conditions.push({ type: "rounds", n: Math.max(1, options.roundsN) });
  if (options.allSpokenExit) conditions.push({ type: "all_spoken", min_each: Math.max(1, options.minEach) });
  if (options.allVotedExit) conditions.push({ type: "all_voted" });
  if (options.manualExit) conditions.push({ type: "user_manual" });
  if (options.tokenBudgetExit) conditions.push({ type: "token_budget", max: Math.max(1, options.tokenBudget) });
  if (options.facilitatorExit) conditions.push({ type: "facilitator_suggests", trigger_if: splitTags(options.facilitatorTags) });
  return conditions;
}

export function parseJsonObject(value: string): { ok: true; value: Record<string, unknown> } | { ok: false; value: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
  } catch {
    return { ok: false, value: {} };
  }
  return { ok: false, value: {} };
}

export function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function newSlotId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `slot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function filterByTags<T extends { tags?: string[] }>(items: T[] | undefined, selected: string[]): T[] {
  if (!items) return [];
  if (!selected.length) return items;
  return items.filter((item) => selected.every((tag) => (item.tags ?? []).includes(tag)));
}
