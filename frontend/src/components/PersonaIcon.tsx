import {
  Anchor,
  BookOpen,
  Brain,
  Compass,
  Crown,
  Eye,
  FlaskConical,
  Flag,
  Gauge,
  Globe,
  Hammer,
  Heart,
  Lightbulb,
  Layers,
  Microscope,
  Rocket,
  Scale,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Users,
  Wrench,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DEFAULT_PERSONA_COLOR, PERSONA_COLORS } from "../constants/colors";

// Re-export for backward compatibility
export { DEFAULT_PERSONA_COLOR, PERSONA_COLORS };

// Curated icon set for persona avatars. Keep this list in sync between the
// picker and the renderer; backend stores the string key only.
export const PERSONA_ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Brain,
  Compass,
  Microscope,
  ShieldCheck,
  Hammer,
  Heart,
  Eye,
  Zap,
  Target,
  Lightbulb,
  Scale,
  Anchor,
  Flag,
  Rocket,
  BookOpen,
  Wrench,
  Layers,
  Users,
  Globe,
  FlaskConical,
  Crown,
  Swords,
  Gauge
};

export const PERSONA_ICON_KEYS = Object.keys(PERSONA_ICONS);

export const DEFAULT_PERSONA_ICON = "Sparkles";

export function resolvePersonaIcon(name: string | undefined | null): LucideIcon {
  if (name && PERSONA_ICONS[name]) return PERSONA_ICONS[name];
  return Sparkles;
}

export function PersonaIcon({
  icon,
  color,
  size = 40,
  iconSize,
  rounded = "full",
  className = ""
}: {
  icon: string | undefined | null;
  color: string | undefined | null;
  size?: number;
  iconSize?: number;
  rounded?: "full" | "lg" | "md";
  className?: string;
}) {
  const Icon = resolvePersonaIcon(icon);
  const tone = color || DEFAULT_PERSONA_COLOR;
  const radiusClass = rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-lg" : "rounded-md";
  const innerSize = iconSize ?? Math.round(size * 0.5);
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center ${radiusClass} ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: `${tone}1f`, // ~12% opacity
        color: tone,
        boxShadow: `inset 0 0 0 1px ${tone}33`
      }}
    >
      <Icon size={innerSize} strokeWidth={2} />
    </span>
  );
}
