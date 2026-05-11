import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface StreamingMessage {
  roomId: string;
  messageId: string;
  personaId: string;
  text: string;
  lastChunkIndex: number;
  lastChunkAt: number;
}

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

interface UIState {
  dark: boolean;
  streaming: Record<string, StreamingMessage>;
  finalizedStreamIds: Record<string, number>;
  connectionStatus: ConnectionStatus;
  connectionRetries: number;
  showApiErrorDetail: boolean;
  toggleDark: () => void;
  appendChunk: (roomId: string, messageId: string, personaId: string, text: string, chunkIndex?: number) => void;
  hydrateStream: (roomId: string, messageId: string, personaId: string, text: string, lastChunkIndex: number) => void;
  clearStream: (messageId: string) => void;
  finalizeStream: (messageId: string) => void;
  finalizeStreams: (messageIds: string[]) => void;
  setConnectionStatus: (status: ConnectionStatus, retries?: number) => void;
  setShowApiErrorDetail: (value: boolean) => void;
}

function pruneFinalized(ids: Record<string, number>, now: number): Record<string, number> {
  const entries = Object.entries(ids)
    .filter(([, timestamp]) => now - timestamp < 10 * 60_000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300);
  return Object.fromEntries(entries);
}

const memoryStorage = new Map<string, string>();
const fallbackStorage = {
  getItem: (name: string) => memoryStorage.get(name) ?? null,
  setItem: (name: string, value: string) => {
    memoryStorage.set(name, value);
  },
  removeItem: (name: string) => {
    memoryStorage.delete(name);
  }
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      dark: false,
      streaming: {},
      finalizedStreamIds: {},
      connectionStatus: "connected",
      connectionRetries: 0,
      showApiErrorDetail: false,
      toggleDark: () => set((state) => ({ dark: !state.dark })),
      setShowApiErrorDetail: (value) => set(() => ({ showApiErrorDetail: value })),
      setConnectionStatus: (status, retries) =>
        set(() => ({
          connectionStatus: status,
          connectionRetries: retries ?? 0
        })),
      appendChunk: (roomId, messageId, personaId, text, chunkIndex) =>
        set((state) => {
          if (state.finalizedStreamIds[messageId]) {
            return state;
          }
          const current = state.streaming[messageId];
          if (chunkIndex !== undefined && current && chunkIndex <= current.lastChunkIndex) {
            return state;
          }
          return {
            streaming: {
              ...state.streaming,
              [messageId]: {
                roomId,
                messageId,
                personaId,
                text: `${current?.text ?? ""}${text}`,
                lastChunkIndex: chunkIndex ?? current?.lastChunkIndex ?? -1,
                lastChunkAt: Date.now()
              }
            }
          };
        }),
      hydrateStream: (roomId, messageId, personaId, text, lastChunkIndex) =>
        set((state) => {
          if (state.finalizedStreamIds[messageId]) {
            return state;
          }
          const current = state.streaming[messageId];
          if (current && current.lastChunkIndex > lastChunkIndex) {
            return state;
          }
          return {
            streaming: {
              ...state.streaming,
              [messageId]: { roomId, messageId, personaId, text, lastChunkIndex, lastChunkAt: Date.now() }
            }
          };
        }),
      clearStream: (messageId) =>
        set((state) => {
          const next = { ...state.streaming };
          delete next[messageId];
          return { streaming: next };
        }),
      finalizeStream: (messageId) =>
        set((state) => {
          const next = { ...state.streaming };
          delete next[messageId];
          const now = Date.now();
          return {
            streaming: next,
            finalizedStreamIds: pruneFinalized({ ...state.finalizedStreamIds, [messageId]: now }, now)
          };
        }),
      finalizeStreams: (messageIds) =>
        set((state) => {
          if (!messageIds.length) return state;
          const nextStreaming = { ...state.streaming };
          const nextFinalized = { ...state.finalizedStreamIds };
          const now = Date.now();
          let changed = false;
          for (const messageId of messageIds) {
            if (nextStreaming[messageId]) {
              delete nextStreaming[messageId];
              changed = true;
            }
            if (!nextFinalized[messageId]) {
              nextFinalized[messageId] = now;
              changed = true;
            }
          }
          if (!changed) return state;
          return {
            streaming: nextStreaming,
            finalizedStreamIds: pruneFinalized(nextFinalized, now)
          };
        })
    }),
    {
      name: "mai-ui",
      storage: createJSONStorage(() => (typeof localStorage === "undefined" ? fallbackStorage : localStorage)),
      partialize: (state) => ({ dark: state.dark, showApiErrorDetail: state.showApiErrorDetail })
    }
  )
);
