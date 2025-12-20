import { create } from 'zustand';
import type { Session, ChatMessage, TodoItem } from './types';

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
  updateSessionName: (sessionId: string, name: string) => void;

  // Current session
  currentSessionId: string | null;
  setCurrentSession: (sessionId: string | null) => void;

  // Session messages (chat format)
  sessionMessages: Map<string, ChatMessage[]>;
  appendMessage: (sessionId: string, role: 'user' | 'assistant', content: string) => void;
  clearMessages: (sessionId: string) => void;

  // Session todos
  sessionTodos: Map<string, TodoItem[]>;
  setSessionTodos: (sessionId: string, todos: TodoItem[]) => void;
  clearTodos: (sessionId: string) => void;
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
  updateSessionName: (sessionId, name) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, name } : s
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

  // Session todos
  sessionTodos: new Map(),
  setSessionTodos: (sessionId, todos) =>
    set((state) => {
      const sessionTodos = new Map(state.sessionTodos);
      sessionTodos.set(sessionId, todos);
      return { sessionTodos };
    }),
  clearTodos: (sessionId) =>
    set((state) => {
      const sessionTodos = new Map(state.sessionTodos);
      sessionTodos.delete(sessionId);
      return { sessionTodos };
    }),
}));
