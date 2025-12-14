import { sessionRegistry, type RegisteredSession } from './session-registry';
import { AgentAPIClient } from './agentapi-client';
import { RelayClient } from './relay-client';

const DAEMON_SOCKET = '/tmp/snowfort-daemon.sock';
const HEALTH_CHECK_INTERVAL = 5000; // 5 seconds

// Configuration (from environment or defaults)
const RELAY_URL = process.env.SNOWFORT_RELAY_URL || 'ws://localhost:8080';
const RELAY_TOKEN = process.env.SNOWFORT_TOKEN || 'test-token-123';

// Map of session ID to AgentAPI client
const clients = new Map<string, AgentAPIClient>();

// Relay client (initialized in startDaemon)
let relayClient: RelayClient | null = null;

async function handleSessionStart(data: {
  id: string;
  port: number;
  cwd: string;
  command: string[];
}): Promise<void> {
  const session: RegisteredSession = {
    id: data.id,
    name: data.command.join(' '),
    cwd: data.cwd,
    port: data.port,
    command: data.command,
    status: 'running',
    startedAt: new Date(),
  };

  sessionRegistry.register(session);

  // Notify relay about new session
  if (relayClient?.isConnected()) {
    relayClient.sendSessionStart(data.id, session.name, session.cwd);
  }

  // Create AgentAPI client for this session
  const client = new AgentAPIClient(data.port);
  clients.set(data.id, client);

  // Subscribe to events and forward to relay
  client.subscribeToEvents((event) => {
    console.log(`[Daemon] Session ${data.id.slice(0, 8)} event:`, event.type);

    if (relayClient?.isConnected()) {
      if (event.type === 'message') {
        const msg = event.data as { content?: string; role?: string };
        if (msg.content) {
          relayClient.sendSessionOutput(data.id, msg.content);
        }
      }
    }
  });
}

async function handleSessionEnd(sessionId: string): Promise<void> {
  const client = clients.get(sessionId);
  if (client) {
    client.disconnect();
    clients.delete(sessionId);
  }
  sessionRegistry.unregister(sessionId);

  // Notify relay
  if (relayClient?.isConnected()) {
    relayClient.sendSessionEnd(sessionId);
  }
}

async function handleRelayMessage(message: { type: string; sessionId?: string; text?: string }): Promise<void> {
  switch (message.type) {
    case 'send_input': {
      if (!message.sessionId || !message.text) return;

      const client = clients.get(message.sessionId);
      if (client) {
        console.log(`[Daemon] Forwarding input to session ${message.sessionId.slice(0, 8)}`);
        try {
          await client.sendMessage(message.text);
        } catch (err) {
          console.error('[Daemon] Failed to send message:', err);
        }
      }
      break;
    }

    case 'subscribe':
    case 'unsubscribe':
      // These are handled by the relay, daemon doesn't need to do anything
      break;
  }
}

async function startUnixSocketServer(): Promise<void> {
  // Clean up old socket
  try {
    await Bun.$`rm -f ${DAEMON_SOCKET}`.quiet();
  } catch {}

  const server = Bun.listen({
    unix: DAEMON_SOCKET,
    socket: {
      data(socket, data) {
        try {
          const message = JSON.parse(data.toString());

          switch (message.type) {
            case 'session_start':
              handleSessionStart(message);
              break;
            case 'session_end':
              handleSessionEnd(message.sessionId);
              break;
            case 'list_sessions':
              socket.write(JSON.stringify(sessionRegistry.getAll()));
              break;
          }
        } catch (error) {
          console.error('[Daemon] Error parsing message:', error);
        }
      },
      error(socket, error) {
        console.error('[Daemon] Socket error:', error);
      },
      close(socket) {},
    },
  });

  console.log(`[Daemon] Unix socket server listening on ${DAEMON_SOCKET}`);
}

async function healthCheckLoop(): Promise<void> {
  while (true) {
    await Bun.sleep(HEALTH_CHECK_INTERVAL);

    for (const [sessionId, client] of clients) {
      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log(`[Daemon] Session ${sessionId.slice(0, 8)} is no longer healthy`);
        await handleSessionEnd(sessionId);
      } else {
        // Check if idle
        try {
          const status = await client.getStatus();
          const newStatus = status.status === 'stable' ? 'idle' : 'running';
          const oldStatus = sessionRegistry.get(sessionId)?.status;

          if (oldStatus !== newStatus) {
            sessionRegistry.updateStatus(sessionId, newStatus);

            // Notify relay of status change
            if (relayClient?.isConnected()) {
              relayClient.sendSessionStatus(sessionId, newStatus);
            }
          }
        } catch {}
      }
    }
  }
}

async function connectToRelay(): Promise<void> {
  console.log(`[Daemon] Connecting to relay at ${RELAY_URL}...`);

  relayClient = new RelayClient(RELAY_URL, RELAY_TOKEN);

  relayClient.setMessageHandler((message) => {
    handleRelayMessage(message as any);
  });

  try {
    await relayClient.connect();
    console.log('[Daemon] Connected to relay');
  } catch (err) {
    console.warn('[Daemon] Failed to connect to relay:', (err as Error).message);
    console.warn('[Daemon] Running in offline mode (local only)');
  }
}

export async function startDaemon(): Promise<void> {
  console.log('[Daemon] Starting Snowfort daemon...');

  await startUnixSocketServer();

  // Connect to relay server
  await connectToRelay();

  // Start health check loop
  healthCheckLoop();

  console.log('[Daemon] Ready.');
  console.log(`[Daemon] Sessions: ${sessionRegistry.size()}`);
  console.log(`[Daemon] Relay connected: ${relayClient?.isConnected() || false}`);

  // Keep process alive
  await new Promise(() => {});
}

// Run if executed directly
if (import.meta.main) {
  startDaemon().catch((error) => {
    console.error('[Daemon] Fatal error:', error);
    process.exit(1);
  });
}
