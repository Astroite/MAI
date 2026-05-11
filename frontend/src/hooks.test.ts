import { describe, expect, it } from "vitest";
import { upsertRoomMessage } from "./hooks";
import type { Message, RoomState } from "./types";

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
