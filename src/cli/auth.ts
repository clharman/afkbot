// CLI Authentication flow
// 1. Start local server to receive OAuth callback
// 2. Open browser for Clerk sign-in
// 3. Exchange auth code for session
// 4. Register device with relay server
// 5. Store device token locally

import { createClerkClient } from '@clerk/backend';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.snowfort');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  deviceToken?: string;
  relayUrl?: string;
  deviceName?: string;
}

export async function loadConfig(): Promise<Config> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {}
  return {};
}

export async function saveConfig(config: Config): Promise<void> {
  await Bun.$`mkdir -p ${CONFIG_DIR}`.quiet();
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getDeviceToken(): Promise<string | null> {
  const config = await loadConfig();
  return config.deviceToken || null;
}

const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DEFAULT_RELAY_URL = 'https://snowfort-relay.onrender.com'; // Will be updated after deploy

export async function auth(): Promise<void> {
  console.log('\n🔐 Snowfort Authentication\n');

  // Check if already authenticated
  const existingConfig = await loadConfig();
  if (existingConfig.deviceToken) {
    console.log('Already authenticated.');
    console.log(`Device: ${existingConfig.deviceName || 'Unknown'}`);
    console.log(`Relay: ${existingConfig.relayUrl || DEFAULT_RELAY_URL}`);
    console.log('\nRun "snowfort auth --logout" to sign out.');
    console.log('Run "snowfort auth --reset" to re-authenticate.\n');
    return;
  }

  // For now, use a simple device code flow simulation
  // In production, we'd use Clerk's device authorization flow
  console.log('Opening browser for authentication...\n');

  // Get device name
  const hostname = (await Bun.$`hostname`.text()).trim();
  const deviceName = `${hostname} (${process.platform})`;

  // Clerk sign-in URL (using their hosted pages)
  const clerkDomain = getClerkDomain();
  if (!clerkDomain) {
    console.error('CLERK_PUBLISHABLE_KEY not configured.');
    console.error('Please set it in your .env file.');
    process.exit(1);
  }

  const signInUrl = `https://${clerkDomain}/sign-in?redirect_url=http://localhost:9876/callback`;

  // Start local callback server
  const callbackPromise = startCallbackServer();

  // Open browser
  const openCommand = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';
  await Bun.$`${openCommand} ${signInUrl}`.quiet().nothrow();

  console.log('If browser did not open, visit:');
  console.log(`  ${signInUrl}\n`);
  console.log('Waiting for authentication...');

  // Wait for callback
  const sessionToken = await callbackPromise;

  if (!sessionToken) {
    console.error('\n❌ Authentication failed or timed out.');
    process.exit(1);
  }

  console.log('\n✓ Authenticated successfully!');

  // Register device with relay
  console.log('Registering device...');

  const relayUrl = existingConfig.relayUrl || DEFAULT_RELAY_URL;

  try {
    const response = await fetch(`${relayUrl.replace('ws://', 'http://').replace('wss://', 'https://')}/api/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ name: deviceName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register device: ${response.statusText}`);
    }

    const { deviceToken } = await response.json() as { deviceToken: string };

    // Save config
    await saveConfig({
      deviceToken,
      relayUrl,
      deviceName,
    });

    console.log(`✓ Device registered: ${deviceName}`);
    console.log('\n🎉 Setup complete! You can now use Snowfort.\n');
    console.log('Start a session with:');
    console.log('  snowfort run -- claude\n');
  } catch (err) {
    console.error('\n❌ Failed to register device:', (err as Error).message);
    console.error('Make sure the relay server is running.');
    process.exit(1);
  }
}

function getClerkDomain(): string | null {
  if (!CLERK_PUBLISHABLE_KEY) return null;

  // Extract domain from publishable key (pk_test_xxx or pk_live_xxx)
  // The key contains base64 encoded domain
  try {
    const base64Part = CLERK_PUBLISHABLE_KEY.split('_')[2];
    const decoded = atob(base64Part);
    // Remove trailing $ if present
    return decoded.replace(/\$$/, '');
  } catch {
    return null;
  }
}

async function startCallbackServer(): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.stop();
      resolve(null);
    }, 300000); // 5 minute timeout

    const server = Bun.serve({
      port: 9876,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/callback') {
          // In a real implementation, we'd exchange the code for a session
          // For now, we'll handle this via Clerk's redirect with session
          const sessionToken = url.searchParams.get('session_token') ||
            url.searchParams.get('__clerk_session');

          clearTimeout(timeout);
          server.stop();

          if (sessionToken) {
            resolve(sessionToken);
            return new Response(successHtml(), {
              headers: { 'Content-Type': 'text/html' },
            });
          } else {
            // If no session token in URL, show page that will get it from Clerk
            resolve(null);
            return new Response(pendingHtml(), {
              headers: { 'Content-Type': 'text/html' },
            });
          }
        }

        return new Response('Not found', { status: 404 });
      },
    });
  });
}

function successHtml(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Snowfort - Authenticated</title>
  <style>
    body { font-family: system-ui; background: #0f0f1a; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .container { text-align: center; }
    h1 { color: #4ade80; }
    p { color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Authenticated!</h1>
    <p>You can close this window and return to your terminal.</p>
  </div>
</body>
</html>
`;
}

function pendingHtml(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Snowfort - Authentication</title>
  <style>
    body { font-family: system-ui; background: #0f0f1a; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .container { text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Completing authentication...</h1>
    <p>Please wait...</p>
  </div>
</body>
</html>
`;
}

export async function logout(): Promise<void> {
  const config = await loadConfig();
  if (!config.deviceToken) {
    console.log('Not currently authenticated.');
    return;
  }

  // Clear local config
  await saveConfig({});
  console.log('✓ Signed out successfully.');
}
