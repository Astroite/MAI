export function previewValue(value: unknown, fallback = "", maxLength = 520): string {
  if (value == null) return fallback;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
