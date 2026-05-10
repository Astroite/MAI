import { DEFAULT_PERSONA_COLOR } from "../constants/colors";

/**
 * Resolve a stable HSL color for a persona based on its id.
 * Falls back to the persona's explicit color, then to DEFAULT_PERSONA_COLOR.
 */
export function personaTone(
  persona: { id?: string | null; color?: string | null } | undefined | null,
  fallbackKey?: string | null,
): string {
  if (persona?.color) return persona.color;
  const key = persona?.id ?? fallbackKey ?? null;
  if (!key) return DEFAULT_PERSONA_COLOR;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1)
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 52% 48%)`;
}
