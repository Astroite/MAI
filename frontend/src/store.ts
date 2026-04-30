import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StreamingMessage {
  messageId: string;
  personaId: string;
  text: string;
}

interface UIState {
  dark: boolean;
  streaming: Record<string, StreamingMessage>;
  toggleDark: () => void;
  appendChunk: (messageId: string, personaId: string, text: string) => void;
  clearStream: (messageId: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      dark: false,
      streaming: {},
      toggleDark: () => set((state) => ({ dark: !state.dark })),
      appendChunk: (messageId, personaId, text) =>
        set((state) => ({
          streaming: {
            ...state.streaming,
            [messageId]: {
              messageId,
              personaId,
              text: `${state.streaming[messageId]?.text ?? ""}${text}`
            }
          }
        })),
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

