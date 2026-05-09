export type Segment = { kind: "speech" | "action"; text: string };

// Match a single asterisk-wrapped run, explicitly refusing to match inside
// bold markdown (`**foo**`). Lookarounds require the opening/closing `*` to
// have neither an adjacent `*` on the outside — so `**bold**` is left whole
// for MarkdownBlock to render normally, while `*action*` is pulled out as
// its own block.
const ACTION_RE = /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g;

/**
 * Split model output into alternating speech and action segments so the UI
 * can render actions as a standalone visual block instead of inline italics.
 * Examples:
 *   "*sigh* 这事儿...*挠头*"
 *     → [action: "sigh", speech: " 这事儿...", action: "挠头"]
 *   "**really important** happened"
 *     → [speech: "**really important** happened"]  (bold, NOT an action)
 */
export function splitActions(raw: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of raw.matchAll(ACTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "speech", text: raw.slice(last, idx) });
    out.push({ kind: "action", text: m[1].trim() });
    last = idx + m[0].length;
  }
  if (last < raw.length) out.push({ kind: "speech", text: raw.slice(last) });
  return out.filter((s) => s.text.trim().length > 0);
}
