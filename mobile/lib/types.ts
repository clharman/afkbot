export interface Session {
  id: string;
  name: string;
  cwd: string;
  status: 'running' | 'idle' | 'ended';
  startedAt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export type RelayMessage =
  | { type: 'auth_ok' }
  | { type: 'auth_error'; message: string }
  | { type: 'sessions_list'; sessions: Session[] }
  | { type: 'session_update'; sessionId: string; name?: string }
  | { type: 'session_output'; sessionId: string; data: string }
  | { type: 'session_message'; sessionId: string; role: 'user' | 'assistant'; content: string }
  | { type: 'session_status'; sessionId: string; status: 'running' | 'idle' | 'ended' }
  | { type: 'session_todos'; sessionId: string; todos: TodoItem[] }
  | { type: 'error'; message: string };

export type OutgoingMessage =
  | { type: 'auth'; token: string }
  | { type: 'list_sessions' }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'send_input'; sessionId: string; text: string }
  | { type: 'track_session'; sessionId: string }
  | { type: 'untrack_session'; sessionId: string }
  | { type: 'register_push_token'; pushToken: string };
