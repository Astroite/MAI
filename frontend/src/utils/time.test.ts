import { describe, expect, it } from "vitest";
import { formatRelativeFromNow, parseServerDate } from "./time";

describe("server time parsing", () => {
  it("treats backend ISO datetimes without timezone as UTC", () => {
    expect(parseServerDate("2026-05-12T05:00:00")?.toISOString()).toBe("2026-05-12T05:00:00.000Z");
  });

  it("preserves explicit timezone offsets", () => {
    expect(parseServerDate("2026-05-12T13:00:00+08:00")?.toISOString()).toBe("2026-05-12T05:00:00.000Z");
  });

  it("uses UTC parsing for relative time", () => {
    const now = Date.parse("2026-05-12T05:01:00Z");
    expect(formatRelativeFromNow("2026-05-12T05:00:00", "en-US", now)).toBe("1 minute ago");
  });
});
