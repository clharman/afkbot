import { authService, isDevToken } from './auth';
import { connectionRegistry, type ClientData, type ClientType } from './connections';
import { pushService } from './push';
import * as db from './db';
import type {
  DaemonMessage,
  RelayToDaemonMessage,
  MobileMessage,
  RelayToMobileMessage,
} from '../types';

const PORT = parseInt(process.env.RELAY_PORT || '8080');

async function handleDaemonMessage(
  ws: Bun.ServerWebSocket<ClientData>,
  message: DaemonMessage
): Promise<void> {
  switch (message.type) {
    case 'auth': {
      // Support dev token for testing
      if (isDevToken(message.token)) {
        connectionRegistry.registerConnection(ws, 'dev-user', 'daemon');
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        return;
      }

      const result = await authService.authenticateDaemon(message.token);
      if (!result.success) {
        ws.send(JSON.stringify({ type: 'auth_error', message: result.error }));
        ws.close();
        return;
      }
      connectionRegistry.registerConnection(ws, result.userId!, 'daemon');
      ws.data.deviceId = result.deviceId;
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      break;
    }

    case 'session_start': {
      if (!ws.data.authenticated) return;
      connectionRegistry.registerSession(ws, {
        id: message.sessionId,
        name: message.name,
        cwd: message.cwd,
        port: 0, // Not relevant for relay
        status: 'running',
        startedAt: new Date(),
      });
      break;
    }

    case 'session_output': {
      if (!ws.data.authenticated) return;
      // Forward to subscribed mobile clients
      connectionRegistry.notifySubscribedClients(ws.data.userId, message.sessionId, {
        type: 'session_output',
        sessionId: message.sessionId,
        data: message.data,
      });
      break;
    }

    case 'session_status': {
      if (!ws.data.authenticated) return;
      connectionRegistry.updateSessionStatus(message.sessionId, message.status);

      // Send push notification if session goes idle and is tracked
      if (message.status === 'idle') {
        const session = connectionRegistry.getSessionsForUser(ws.data.userId)
          .find(s => s.id === message.sessionId);
        if (session && connectionRegistry.isSessionTracked(ws.data.userId, message.sessionId)) {
          pushService.sendSessionIdleNotification(ws.data.userId, message.sessionId, session.name);
        }
      }
      break;
    }

    case 'session_end': {
      if (!ws.data.authenticated) return;
      const session = connectionRegistry.getSessionsForUser(ws.data.userId)
        .find(s => s.id === message.sessionId);

      connectionRegistry.updateSessionStatus(message.sessionId, 'ended');

      // Send push notification if session was tracked
      if (session && connectionRegistry.isSessionTracked(ws.data.userId, message.sessionId)) {
        pushService.sendSessionEndedNotification(ws.data.userId, message.sessionId, session.name);
      }
      break;
    }
  }
}

async function handleMobileMessage(
  ws: Bun.ServerWebSocket<ClientData>,
  message: MobileMessage
): Promise<void> {
  switch (message.type) {
    case 'auth': {
      // Support dev token for testing
      if (isDevToken(message.token)) {
        connectionRegistry.registerConnection(ws, 'dev-user', 'mobile');
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        return;
      }

      const result = await authService.authenticateMobile(message.token);
      if (!result.success) {
        ws.send(JSON.stringify({ type: 'auth_error', message: result.error }));
        ws.close();
        return;
      }
      connectionRegistry.registerConnection(ws, result.userId!, 'mobile');
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      break;
    }

    case 'list_sessions': {
      if (!ws.data.authenticated) return;
      const sessions = connectionRegistry.getSessionsForUser(ws.data.userId);
      ws.send(JSON.stringify({ type: 'sessions_list', sessions }));
      break;
    }

    case 'subscribe': {
      if (!ws.data.authenticated) return;
      const success = connectionRegistry.subscribeToSession(ws, message.sessionId);
      if (!success) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Session not found or not accessible',
        }));
      }
      break;
    }

    case 'unsubscribe': {
      if (!ws.data.authenticated) return;
      connectionRegistry.unsubscribeFromSession(ws, message.sessionId);
      break;
    }

    case 'send_input': {
      if (!ws.data.authenticated) return;
      // Forward to daemon
      const daemonWs = connectionRegistry.getDaemonForSession(message.sessionId);
      if (daemonWs) {
        daemonWs.send(JSON.stringify({
          type: 'send_input',
          sessionId: message.sessionId,
          text: message.text,
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Session daemon not connected',
        }));
      }
      break;
    }

    case 'track_session': {
      if (!ws.data.authenticated) return;
      connectionRegistry.trackSession(ws.data.userId, message.sessionId);
      break;
    }

    case 'untrack_session': {
      if (!ws.data.authenticated) return;
      connectionRegistry.untrackSession(ws.data.userId, message.sessionId);
      break;
    }

    case 'register_push_token': {
      if (!ws.data.authenticated) return;
      pushService.registerToken(ws.data.userId, message.pushToken);
      break;
    }
  }
}

const server = Bun.serve<ClientData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        ...connectionRegistry.getStats(),
        push: pushService.getStats(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Device registration API
    if (url.pathname === '/api/devices' && req.method === 'POST') {
      try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return new Response(JSON.stringify({ error: 'Missing authorization' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const token = authHeader.slice(7);

        // Verify Clerk token
        const result = await authService.authenticateMobile(token);
        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Get device name from body
        const body = await req.json() as { name: string };
        const deviceName = body.name || 'Unknown Device';

        // Create device in database
        const device = await db.createDevice(result.userId!, deviceName);
        if (!device) {
          return new Response(JSON.stringify({ error: 'Failed to create device' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          deviceToken: device.device_token,
          deviceId: device.id,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('[Relay] Device registration error:', err);
        return new Response(JSON.stringify({ error: 'Internal error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // WebSocket upgrade
    if (url.pathname === '/ws/daemon') {
      const success = server.upgrade(req, {
        data: { type: 'daemon' as ClientType, userId: '', authenticated: false, subscribedSessions: new Set() },
      });
      return success ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    if (url.pathname === '/ws/mobile') {
      const success = server.upgrade(req, {
        data: { type: 'mobile' as ClientType, userId: '', authenticated: false, subscribedSessions: new Set() },
      });
      return success ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    open(ws) {
      console.log(`[Relay] WebSocket opened: ${ws.data.type}`);
    },

    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());

        if (ws.data.type === 'daemon') {
          handleDaemonMessage(ws, data as DaemonMessage);
        } else {
          handleMobileMessage(ws, data as MobileMessage);
        }
      } catch (err) {
        console.error('[Relay] Error parsing message:', err);
      }
    },

    close(ws) {
      connectionRegistry.removeConnection(ws);
    },

    error(ws, error) {
      console.error('[Relay] WebSocket error:', error);
    },
  },
});

console.log(`[Relay] Server running on http://localhost:${PORT}`);
console.log(`[Relay] Daemon WebSocket: ws://localhost:${PORT}/ws/daemon`);
console.log(`[Relay] Mobile WebSocket: ws://localhost:${PORT}/ws/mobile`);
console.log(`[Relay] Health check: http://localhost:${PORT}/health`);
console.log(`[Relay] Test token: test-token-123`);
