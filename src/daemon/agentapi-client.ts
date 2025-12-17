import type { AgentMessage, AgentStatus } from '../types';

export interface MessageEvent {
  id: number;
  role: 'agent' | 'user';
  message: string;
  time: string;
}

export interface StatusEvent {
  status: 'stable' | 'running';
  agent_type: string;
}

export interface AgentAPIEvent {
  type: 'message_update' | 'status_change';
  data: MessageEvent | StatusEvent;
}

export class AgentAPIClient {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private onMessage: ((event: AgentAPIEvent) => void) | null = null;
  private abortController: AbortController | null = null;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  async getStatus(): Promise<AgentStatus> {
    const response = await fetch(`${this.baseUrl}/status`);
    if (!response.ok) {
      throw new Error(`Status request failed: ${response.statusText}`);
    }
    return response.json();
  }

  async getMessages(): Promise<AgentMessage[]> {
    const response = await fetch(`${this.baseUrl}/messages`);
    if (!response.ok) {
      throw new Error(`Messages request failed: ${response.statusText}`);
    }
    return response.json();
  }

  async sendMessage(text: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', content: text }),
    });
    if (!response.ok) {
      throw new Error(`Send message failed: ${response.statusText}`);
    }
  }

  subscribeToEvents(callback: (event: AgentAPIEvent) => void): void {
    this.onMessage = callback;

    // Use fetch with streaming for SSE since Bun's EventSource may have issues
    this.connectSSE();
  }

  private async connectSSE(): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.baseUrl}/events`, {
        signal: this.abortController.signal,
      });
      if (!response.ok || !response.body) {
        console.error('[AgentAPI] SSE connection failed');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (this.onMessage && currentEventType) {
                this.onMessage({
                  type: currentEventType as 'message_update' | 'status_change',
                  data,
                });
              }
            } catch {
              // Skip malformed JSON
            }
            currentEventType = ''; // Reset after processing
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('[AgentAPI] SSE error:', error);
        // Try to reconnect after a delay
        setTimeout(() => this.connectSSE(), 3000);
      }
    }
  }

  disconnect(): void {
    this.onMessage = null;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return true;
    } catch {
      return false;
    }
  }
}
