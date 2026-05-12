import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api.runTurn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends optional director instruction to /turn", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.runTurn("room-1", "persona-1", "临时含糊回应。");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/room-1/turn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          speaker_persona_id: "persona-1",
          director_instruction: "临时含糊回应。"
        })
      })
    );
  });

  it("does not need a speaker persona for next beat instructions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.runTurn("room-1", undefined, "下一拍压低声音。");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/room-1/turn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ director_instruction: "下一拍压低声音。" })
      })
    );
  });
});
