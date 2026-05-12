import { describe, expect, it, vi } from "vitest";
import { handleRoomDeletedEvent, upsertRoomMessage } from "./hooks";
import { queryKeys } from "./queryKeys";
import type { Message, MessageType, RoomState } from "./types";

function message(id: string, content: string): Message {
  return { id, content } as Message;
}

describe("upsertRoomMessage", () => {
  it("appends new final messages", () => {
    const state = { messages: [message("msg-1", "one")] } as RoomState;
    const next = upsertRoomMessage(state, message("msg-2", "two"));

    expect(next?.messages.map((item) => item.id)).toEqual(["msg-1", "msg-2"]);
  });

  it("replaces existing final messages without duplicating", () => {
    const state = { messages: [message("msg-1", "old")] } as RoomState;
    const next = upsertRoomMessage(state, message("msg-1", "new"));

    expect(next?.messages).toHaveLength(1);
    expect(next?.messages[0].content).toBe("new");
  });
});

describe("frontend contracts", () => {
  it("accepts Story World message types", () => {
    const messageTypes: MessageType[] = ["narration", "participant.enter", "participant.exit"];
    expect(messageTypes).toContain("narration");
  });

  it("handles room.deleted by clearing room state and returning home", () => {
    const removeQueries = vi.fn();
    const invalidateQueries = vi.fn();
    const clearRoomStreams = vi.fn();
    const navigateHome = vi.fn();

    handleRoomDeletedEvent({
      roomId: "room-deleted",
      queryClient: { removeQueries, invalidateQueries },
      clearRoomStreams,
      navigateHome
    });

    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.room("room-deleted"),
      exact: true
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.rooms });
    expect(clearRoomStreams).toHaveBeenCalledWith("room-deleted");
    expect(navigateHome).toHaveBeenCalledTimes(1);
  });
});
