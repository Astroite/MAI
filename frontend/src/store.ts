import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StreamingMessage {
  messageId: string;
  personaId: string;
  text: string;
  lastChunkIndex: number;
}

interface UIState {
  dark: boolean;
  streaming: Record<string, StreamingMessage>;
  toggleDark: () => void;
  appendChunk: (messageId: string, personaId: string, text: string, chunkIndex?: number) => void;
  hydrateStream: (messageId: string, personaId: string, text: string, lastChunkIndex: number) => void;
  clearStream: (messageId: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      dark: false,
      streaming: {},
      toggleDark: () => set((state) => ({ dark: !state.dark })),
      appendChunk: (messageId, personaId, text, chunkIndex) =>
        set((state) => {
          const current = state.streaming[messageId];
          if (chunkIndex !== undefined && current && chunkIndex <= current.lastChunkIndex) {
            return state;
          }
          return {
            streaming: {
              ...state.streaming,
              [messageId]: {
                messageId,
                personaId,
                text: `${current?.text ?? ""}${text}`,
                lastChunkIndex: chunkIndex ?? current?.lastChunkIndex ?? -1
              }
            }
          };
        }),
      hydrateStream: (messageId, personaId, text, lastChunkIndex) =>
        set((state) => {
          const current = state.streaming[messageId];
          if (current && current.lastChunkIndex > lastChunkIndex) {
            return state;
          }
          return {
            streaming: {
              ...state.streaming,
              [messageId]: { messageId, personaId, text, lastChunkIndex }
            }
          };
        }),
      clearStream: (messageId) =>
        set((state) => {
          const next = { ...state.streaming };
          delete next[messageId];
          return { streaming: next };
        })
    }),
    {
      name: "mai-ui",
      partialize: (state) => ({ dark: state.dark })
    }
  )
);
