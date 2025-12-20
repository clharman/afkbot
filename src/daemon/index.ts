import { RelayClient } from './relay-client';
import { loadConfig } from '../cli/auth';
import { watch, type FSWatcher } from 'fs';
import { readFile, readdir } from 'fs/promises';
import type { Socket } from 'bun';

const DAEMON_SOCKET = '/tmp/snowfort-daemon.sock';

// Configuration
let RELAY_URL = process.env.SNOWFORT_RELAY_URL || 'ws://localhost:8080';
let RELAY_TOKEN = process.env.SNOWFORT_TOKEN || '';

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isComplete?: boolean; // True if this is a complete response (has stop_reason)
}

interface Session {
  id: string;
  name: string;
  cwd: string;
  projectDir: string;
  command: string[];
  socket: Socket<unknown>;
  status: 'running' | 'idle';
  watcher?: FSWatcher;
  watchedFile?: string;
  lastFileSize: number;
  seenMessages: Set<string>; // Track message UUIDs to avoid duplicates
  startedAt: Date; // Only process messages after this time
  existingFiles: Set<string>; // Files that existed before session started
}

// Active sessions
const sessions = new Map<string, Session>();

// Files already claimed by sessions (to prevent two sessions watching the same file)
const claimedFiles = new Set<string>();

// Relay client
let relayClient: RelayClient | null = null;

async function loadDaemonConfig(): Promise<void> {
  const config = await loadConfig();

  if (config.deviceToken) {
    RELAY_TOKEN = config.deviceToken;
  }
  if (config.relayUrl) {
    RELAY_URL = config.relayUrl;
  }

  if (!RELAY_TOKEN) {
    console.log('[Daemon] No device token found, using dev mode');
    RELAY_TOKEN = 'dev-token';
  }
}

// Check if a JSONL line indicates response completion (stop_hook_summary)
function isStopHookSummary(line: string): boolean {
  try {
    const data = JSON.parse(line);
    return data.type === 'system' && data.subtype === 'stop_hook_summary';
  } catch {
    return false;
  }
}

// Parse a JSONL line and extract message if it's a user or assistant message
function parseJsonlLine(line: string): ParsedMessage | null {
  try {
    const data = JSON.parse(line);

    // Skip non-message types
    if (data.type !== 'user' && data.type !== 'assistant') {
      return null;
    }

    // Skip meta/system messages
    if (data.isMeta || data.subtype) {
      return null;
    }

    const message = data.message;
    if (!message || !message.role) {
      return null;
    }

    // Extract content
    let content = '';
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      // Assistant messages have content as array
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          content += block.text;
        }
      }
    }

    if (!content.trim()) {
      return null;
    }

    return {
      role: message.role as 'user' | 'assistant',
      content: content.trim(),
      timestamp: data.timestamp || new Date().toISOString(),
      isComplete: false, // Will be determined by stop_hook_summary
    };
  } catch {
    return null;
  }
}

// Get all JSONL files in the project directory (excluding agent sidechain files)
async function getJsonlFiles(projectDir: string): Promise<Set<string>> {
  try {
    const files = await readdir(projectDir);
    // Only consider UUID-named JSONL files, not agent-* sidechain files
    return new Set(files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-')).map(f => `${projectDir}/${f}`));
  } catch {
    return new Set();
  }
}

// Find a NEW JSONL file that wasn't in the existing set and isn't claimed by another session
async function findNewJsonlFile(projectDir: string, existingFiles: Set<string>): Promise<string | null> {
  try {
    const files = await readdir(projectDir);
    // Only consider UUID-named JSONL files, not agent-* sidechain files
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

    // Find files that are NEW (not in existingFiles) and not claimed by another session
    const newFiles = jsonlFiles
      .map(f => `${projectDir}/${f}`)
      .filter(path => !existingFiles.has(path) && !claimedFiles.has(path));

    if (newFiles.length === 0) return null;

    // If multiple new files, return the most recently modified
    if (newFiles.length === 1) return newFiles[0];

    const fileStats = await Promise.all(
      newFiles.map(async (path) => {
        const stat = await Bun.file(path).stat();
        return { path, mtime: stat?.mtime || 0 };
      })
    );

    fileStats.sort((a, b) => (b.mtime as number) - (a.mtime as number));
    return fileStats[0]?.path || null;
  } catch (err) {
    console.error('[Daemon] Error finding new JSONL file:', err);
    return null;
  }
}

// Read new content from JSONL file and parse messages
async function processJsonlUpdates(session: Session): Promise<void> {
  if (!session.watchedFile) return;

  try {
    const file = Bun.file(session.watchedFile);
    const content = await file.text();
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      // Create a hash of the line to track if we've seen it
      const lineHash = Bun.hash(line).toString();
      if (session.seenMessages.has(lineHash)) {
        continue;
      }
      session.seenMessages.add(lineHash);

      // Check for stop_hook_summary which signals response completion
      if (isStopHookSummary(line)) {
        if (session.status !== 'idle' && relayClient?.isConnected()) {
          console.log(`[Daemon] Response complete for session ${session.id}`);
          session.status = 'idle';
          relayClient.sendSessionStatus(session.id, 'idle');
        }
        continue;
      }

      const parsed = parseJsonlLine(line);
      if (parsed && relayClient?.isConnected()) {
        // Skip messages from before this session started
        const messageTime = new Date(parsed.timestamp);
        if (messageTime < session.startedAt) {
          continue;
        }

        console.log(`[Daemon] New ${parsed.role} message for session ${session.id}`);
        relayClient.sendMessage(session.id, parsed.role, parsed.content);

        // Update status to 'running' on user message
        if (parsed.role === 'user' && session.status !== 'running') {
          session.status = 'running';
          relayClient.sendSessionStatus(session.id, 'running');
        }
      }
    }
  } catch (err) {
    console.error('[Daemon] Error processing JSONL:', err);
  }
}

// Start watching the project directory for JSONL changes
async function startWatching(session: Session): Promise<void> {
  // Look for a NEW JSONL file (not one that existed before session started)
  const jsonlFile = await findNewJsonlFile(session.projectDir, session.existingFiles);

  if (!jsonlFile) {
    console.log(`[Daemon] Waiting for new JSONL file in ${session.projectDir}`);
  } else {
    session.watchedFile = jsonlFile;
    claimedFiles.add(jsonlFile);
    console.log(`[Daemon] Watching NEW file: ${jsonlFile}`);

    // Initial read
    await processJsonlUpdates(session);
  }

  // Watch the directory for changes
  try {
    session.watcher = watch(session.projectDir, { recursive: false }, async (eventType, filename) => {
      if (!filename?.endsWith('.jsonl')) return;

      const filePath = `${session.projectDir}/${filename}`;

      // Only process updates if:
      // 1. We don't have a file yet (need to find a NEW one)
      // 2. This is our watched file
      if (!session.watchedFile) {
        const newFile = await findNewJsonlFile(session.projectDir, session.existingFiles);
        if (newFile) {
          console.log(`[Daemon] Found NEW JSONL file: ${newFile}`);
          session.watchedFile = newFile;
          claimedFiles.add(newFile);
        }
      }

      // Only process if this change is for our watched file
      if (session.watchedFile && filePath === session.watchedFile) {
        await processJsonlUpdates(session);
      }
    });
  } catch (err) {
    console.error('[Daemon] Error setting up watcher:', err);
  }

  // Also poll periodically in case file watching misses updates
  const pollInterval = setInterval(async () => {
    if (!sessions.has(session.id)) {
      clearInterval(pollInterval);
      return;
    }

    // Only try to find a file if we don't have one yet
    if (!session.watchedFile) {
      const newFile = await findNewJsonlFile(session.projectDir, session.existingFiles);
      if (newFile) {
        console.log(`[Daemon] Poll found NEW JSONL file: ${newFile}`);
        session.watchedFile = newFile;
        claimedFiles.add(newFile);
      }
    }

    if (session.watchedFile) {
      await processJsonlUpdates(session);
    }
  }, 1000);
}

function stopWatching(session: Session): void {
  if (session.watcher) {
    session.watcher.close();
  }
  // Unclaim the file so other sessions can potentially use it
  if (session.watchedFile) {
    claimedFiles.delete(session.watchedFile);
  }
}

async function handleSessionMessage(socket: Socket<unknown>, message: any): Promise<void> {
  switch (message.type) {
    case 'session_start': {
      // Get existing JSONL files BEFORE creating the session
      // so we can identify which file is NEW for this session
      const existingFiles = await getJsonlFiles(message.projectDir);

      const session: Session = {
        id: message.id,
        name: message.name || message.command?.join(' ') || 'Unknown',
        cwd: message.cwd,
        projectDir: message.projectDir,
        command: message.command,
        socket,
        status: 'running',
        lastFileSize: 0,
        seenMessages: new Set(),
        startedAt: new Date(),
        existingFiles,
      };
      sessions.set(message.id, session);
      console.log(`[Daemon] Session started: ${message.id} - ${session.name}`);
      console.log(`[Daemon] Project dir: ${session.projectDir}`);
      console.log(`[Daemon] Existing JSONL files: ${existingFiles.size}`);

      // Notify relay
      if (relayClient?.isConnected()) {
        relayClient.sendSessionStart(message.id, session.name, session.cwd);
      }

      // Start watching JSONL files
      startWatching(session);
      break;
    }

    case 'session_end': {
      const session = sessions.get(message.sessionId);
      if (session) {
        console.log(`[Daemon] Session ended: ${message.sessionId}`);
        stopWatching(session);
        sessions.delete(message.sessionId);

        if (relayClient?.isConnected()) {
          relayClient.sendSessionEnd(message.sessionId);
        }
      }
      break;
    }
  }
}

function handleRelayMessage(message: any): void {
  switch (message.type) {
    case 'send_input': {
      // Forward input from mobile to the PTY
      const session = sessions.get(message.sessionId);
      if (session) {
        console.log(`[Daemon] Forwarding input to session ${message.sessionId}`);
        // Send text first, then Enter key separately after a brief delay
        session.socket.write(JSON.stringify({
          type: 'input',
          text: message.text,
        }) + '\n');

        // Small delay then send Enter to submit
        setTimeout(() => {
          session.socket.write(JSON.stringify({
            type: 'input',
            text: '\r',
          }) + '\n');
        }, 50);
      }
      break;
    }
  }
}

async function startUnixSocketServer(): Promise<void> {
  try {
    await Bun.$`rm -f ${DAEMON_SOCKET}`.quiet();
  } catch {}

  Bun.listen({
    unix: DAEMON_SOCKET,
    socket: {
      data(socket, data) {
        const messages = data.toString().split('\n').filter(Boolean);

        for (const msg of messages) {
          try {
            const parsed = JSON.parse(msg);
            handleSessionMessage(socket, parsed);
          } catch (error) {
            console.error('[Daemon] Error parsing message:', error);
          }
        }
      },
      error(socket, error) {
        console.error('[Daemon] Socket error:', error);
      },
      close(socket) {
        for (const [id, session] of sessions) {
          if (session.socket === socket) {
            console.log(`[Daemon] Session disconnected: ${id}`);
            stopWatching(session);
            sessions.delete(id);

            if (relayClient?.isConnected()) {
              relayClient.sendSessionEnd(id);
            }
            break;
          }
        }
      },
    },
  });

  console.log(`[Daemon] Unix socket server listening on ${DAEMON_SOCKET}`);
}

async function connectToRelay(): Promise<void> {
  console.log(`[Daemon] Connecting to relay at ${RELAY_URL}...`);

  relayClient = new RelayClient(RELAY_URL, RELAY_TOKEN);
  relayClient.setMessageHandler(handleRelayMessage);

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

  await loadDaemonConfig();
  await startUnixSocketServer();
  await connectToRelay();

  console.log('[Daemon] Ready.');
  console.log(`[Daemon] Relay: ${RELAY_URL}`);
  console.log(`[Daemon] Connected: ${relayClient?.isConnected() || false}`);

  await new Promise(() => {});
}

if (import.meta.main) {
  startDaemon().catch((error) => {
    console.error('[Daemon] Fatal error:', error);
    process.exit(1);
  });
}
