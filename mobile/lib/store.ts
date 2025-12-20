import { create } from 'zustand';
import type { Session, ChatMessage } from './types';

interface AppState {
  // Auth
  token: string | null;
  isAuthenticated: boolean;
  setToken: (token: string | null) => void;

  // Connection
  isConnected: boolean;
  setConnected: (connected: boolean) => void;

  // Sessions
  sessions: Session[];
  setSessions: (sessions: Session[]) => void;
  updateSessionStatus: (sessionId: string, status: Session['status']) => void;

  // Current session
  currentSessionId: string | null;
  setCurrentSession: (sessionId: string | null) => void;

  // Session messages (chat format)
  sessionMessages: Map<string, ChatMessage[]>;
  appendMessage: (sessionId: string, role: 'user' | 'assistant', content: string) => void;
  clearMessages: (sessionId: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Auth
  token: null,
  isAuthenticated: false,
  setToken: (token) => set({ token, isAuthenticated: !!token }),

  // Connection
  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),

  // Sessions
  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  updateSessionStatus: (sessionId, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status } : s
      ),
    })),

  // Current session
  currentSessionId: null,
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  // Session messages
  sessionMessages: new Map(),
  appendMessage: (sessionId, role, content) =>
    set((state) => {
      const messages = new Map(state.sessionMessages);
      const existing = messages.get(sessionId) || [];
      messages.set(sessionId, [...existing, { role, content }]);
      return { sessionMessages: messages };
    }),
  clearMessages: (sessionId) =>
    set((state) => {
      const messages = new Map(state.sessionMessages);
      messages.delete(sessionId);
      return { sessionMessages: messages };
    }),
}));
