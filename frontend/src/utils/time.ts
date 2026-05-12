const SERVER_DATETIME_WITHOUT_ZONE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const RELATIVE_THRESHOLDS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
  { unit: "second", ms: 1000 }
];

export function parseServerDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = SERVER_DATETIME_WITHOUT_ZONE.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(
  value: string | Date | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }
): string {
  const date = parseServerDate(value);
  if (!date) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatTimeOfDay(value: string | Date | null | undefined, locale: string): string {
  return formatLocalDateTime(value, locale, { hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeFromNow(
  value: string | Date | null | undefined,
  locale: string,
  now: number = Date.now()
): string {
  const date = parseServerDate(value);
  if (!date) return "";
  const diff = date.getTime() - now;
  const formatter = new Intl.RelativeTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { numeric: "auto" });
  const abs = Math.abs(diff);
  for (const { unit, ms } of RELATIVE_THRESHOLDS) {
    if (abs >= ms || unit === "second") {
      return formatter.format(Math.round(diff / ms), unit);
    }
  }
  return formatter.format(0, "second");
}
