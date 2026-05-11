import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  connectionStatus: ConnectionStatus;
  connectionRetries: number;
  showApiErrorDetail: boolean;
  toggleDark: () => void;
  appendChunk: (roomId: string, messageId: string, personaId: string, text: string, chunkIndex?: number) => void;
  hydrateStream: (roomId: string, messageId: string, personaId: string, text: string, lastChunkIndex: number) => void;
  clearStream: (messageId: string) => void;
  setConnectionStatus: (status: ConnectionStatus, retries?: number) => void;
  setShowApiErrorDetail: (value: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      dark: false,
      streaming: {},
      connectionStatus: "connected",
      connectionRetries: 0,
      showApiErrorDetail: false,
      toggleDark: () => set((state) => ({ dark: !state.dark })),
      setShowApiErrorDetail: (value) => set(() => ({ showApiErrorDetail: value })),
      setConnectionStatus: (status, retries) =>
        set(() => ({
          connectionStatus: status,
          connectionRetries: retries ?? (status === "connected" ? 0 : 0)
        })),
      appendChunk: (roomId, messageId, personaId, text, chunkIndex) =>
        set((state) => {
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
        })
    }),
    {
      name: "mai-ui",
      partialize: (state) => ({ dark: state.dark, showApiErrorDetail: state.showApiErrorDetail })
    }
  )
);
