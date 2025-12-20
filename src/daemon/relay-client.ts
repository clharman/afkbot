import type { DaemonMessage, RelayToDaemonMessage } from '../types';

type MessageHandler = (message: RelayToDaemonMessage) => void;

export class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private onMessage: MessageHandler | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private connected = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${this.url}/ws/daemon`);

        this.ws.onopen = () => {
          console.log('[RelayClient] Connected to relay');
          this.reconnectAttempts = 0;

          // Authenticate
          this.send({ type: 'auth', token: this.token });
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as RelayToDaemonMessage;

            if (message.type === 'auth_ok') {
              console.log('[RelayClient] Authenticated');
              this.connected = true;
              resolve();
            } else if (message.type === 'auth_error') {
              console.error('[RelayClient] Auth failed:', message.message);
              reject(new Error(message.message));
            } else if (this.onMessage) {
              this.onMessage(message);
            }
          } catch (err) {
            console.error('[RelayClient] Error parsing message:', err);
          }
        };

        this.ws.onclose = () => {
          console.log('[RelayClient] Disconnected');
          this.connected = false;
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[RelayClient] WebSocket error');
          if (!this.connected) {
            reject(new Error('Connection failed'));
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RelayClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[RelayClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[RelayClient] Reconnect failed:', err.message);
      });
    }, delay);
  }

  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  send(message: DaemonMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendSessionStart(sessionId: string, name: string, cwd: string): void {
    this.send({ type: 'session_start', sessionId, name, cwd });
  }

  sendSessionUpdate(sessionId: string, name: string): void {
    this.send({ type: 'session_update', sessionId, name });
  }

  sendSessionTodos(sessionId: string, todos: Array<{ content: string; status: string; activeForm?: string }>): void {
    this.send({ type: 'session_todos', sessionId, todos } as any);
  }

  sendSessionOutput(sessionId: string, data: string): void {
    this.send({ type: 'session_output', sessionId, data });
  }

  sendMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    this.send({ type: 'session_message', sessionId, role, content });
  }

  sendSessionStatus(sessionId: string, status: 'running' | 'idle'): void {
    this.send({ type: 'session_status', sessionId, status });
  }

  sendSessionEnd(sessionId: string): void {
    this.send({ type: 'session_end', sessionId });
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
