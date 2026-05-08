import { AtSign } from "lucide-react";

export function MentionChip({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand align-middle">
      <span
        aria-hidden="true"
        className="grid h-3 w-3 place-items-center rounded-full"
        style={color ? { background: color } : undefined}
      >
        {!color && <AtSign size={10} />}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
