import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./store";

describe("streaming UI store", () => {
  beforeEach(() => {
    useUIStore.setState({ streaming: {}, finalizedStreamIds: {} });
  });

  it("deduplicates chunks by index", () => {
    const store = useUIStore.getState();
    store.hydrateStream("room-1", "msg-1", "persona-1", "hel", 0);
    useUIStore.getState().appendChunk("room-1", "msg-1", "persona-1", "lo", 1);
    useUIStore.getState().appendChunk("room-1", "msg-1", "persona-1", " duplicate", 1);

    expect(useUIStore.getState().streaming["msg-1"].text).toBe("hello");
  });

  it("blocks stale chunks after finalization", () => {
    const store = useUIStore.getState();
    store.hydrateStream("room-1", "msg-1", "persona-1", "partial", 0);
    useUIStore.getState().finalizeStream("msg-1");
    useUIStore.getState().appendChunk("room-1", "msg-1", "persona-1", " late", 1);
    useUIStore.getState().hydrateStream("room-1", "msg-1", "persona-1", "stale", 2);

    expect(useUIStore.getState().streaming["msg-1"]).toBeUndefined();
  });

  it("clearStream does not mark a message finalized", () => {
    const store = useUIStore.getState();
    store.hydrateStream("room-1", "msg-1", "persona-1", "old", 0);
    useUIStore.getState().clearStream("msg-1");
    useUIStore.getState().appendChunk("room-1", "msg-1", "persona-1", "new", 1);

    expect(useUIStore.getState().streaming["msg-1"].text).toBe("new");
  });

  it("finalizes multiple messages in one update", () => {
    const store = useUIStore.getState();
    store.hydrateStream("room-1", "msg-1", "persona-1", "one", 0);
    useUIStore.getState().hydrateStream("room-1", "msg-2", "persona-2", "two", 0);
    useUIStore.getState().finalizeStreams(["msg-1", "msg-2"]);

    expect(useUIStore.getState().streaming).toEqual({});
    expect(useUIStore.getState().finalizedStreamIds["msg-1"]).toBeTypeOf("number");
    expect(useUIStore.getState().finalizedStreamIds["msg-2"]).toBeTypeOf("number");
  });
});
