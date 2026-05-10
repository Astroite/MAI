/**
 * Shared color palette for persona avatars, world covers, and color pickers.
 * Keep this as the single source of truth — do NOT duplicate in page files.
 */
export const PERSONA_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#64748b",
];

/** Subset palette without the gray entry — used for world/cover color pickers. */
export const COVER_PALETTE = PERSONA_COLORS.slice(0, 14);

export const DEFAULT_PERSONA_COLOR = "#3b82f6";
