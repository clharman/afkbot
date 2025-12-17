// CLI Authentication flow using device code
// 1. Request a device code from relay
// 2. User visits URL to sign in with Clerk and enter code
// 3. CLI polls until code is verified
// 4. Receive device token

import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.snowfort');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_RELAY_URL = 'wss://snowfort.onrender.com';

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

function getRelayHttpUrl(wsUrl: string): string {
  return wsUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

export async function auth(options?: { logout?: boolean; reset?: boolean }): Promise<void> {
  if (options?.logout) {
    return logout();
  }

  console.log('\n🔐 Snowfort Authentication\n');

  // Check if already authenticated
  const existingConfig = await loadConfig();

  if (existingConfig.deviceToken && !options?.reset) {
    console.log('Already authenticated.');
    console.log(`Device: ${existingConfig.deviceName || 'Unknown'}`);
    console.log(`Relay: ${existingConfig.relayUrl || DEFAULT_RELAY_URL}`);
    console.log('\nRun "snowfort auth --logout" to sign out.');
    console.log('Run "snowfort auth --reset" to re-authenticate.\n');
    return;
  }

  // Get device name
  const hostname = (await Bun.$`hostname`.text()).trim();
  const deviceName = `${hostname} (${process.platform})`;
  const relayUrl = existingConfig.relayUrl || DEFAULT_RELAY_URL;
  const httpUrl = getRelayHttpUrl(relayUrl);

  console.log(`Connecting to ${relayUrl}...\n`);

  // Request device code
  let deviceCode: string;
  let verificationUrl: string;

  try {
    const response = await fetch(`${httpUrl}/api/device-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get device code: ${response.statusText}`);
    }

    const data = await response.json() as { code: string; verification_url: string };
    deviceCode = data.code;
    verificationUrl = data.verification_url;
  } catch (err) {
    console.error('❌ Failed to connect to relay server.');
    console.error(`   Make sure ${relayUrl} is accessible.\n`);
    console.error(`   Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Show code to user
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  Your device code:  ${deviceCode}`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('To authenticate, visit:');
  console.log(`  ${verificationUrl}`);
  console.log('');

  // Try to open browser
  const openCommand = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';
  await Bun.$`${openCommand} ${verificationUrl}`.quiet().nothrow();

  console.log('Waiting for authentication...\n');

  // Poll for completion
  const maxAttempts = 120; // 5 minutes at 2.5s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await Bun.sleep(2500);

    try {
      const response = await fetch(`${httpUrl}/api/device-code/${deviceCode}`);

      if (response.status === 200) {
        const data = await response.json() as { device_token: string };

        // Save config
        await saveConfig({
          deviceToken: data.device_token,
          relayUrl,
          deviceName,
        });

        console.log('✓ Authenticated successfully!');
        console.log(`✓ Device registered: ${deviceName}`);
        console.log('\n🎉 Setup complete! You can now use Snowfort.\n');
        console.log('Start a session with:');
        console.log('  snowfort run -- claude\n');
        return;
      } else if (response.status === 202) {
        // Still waiting, show progress
        process.stdout.write('.');
      } else if (response.status === 410) {
        console.log('\n\n❌ Device code expired. Please try again.\n');
        process.exit(1);
      }
    } catch (err) {
      // Network error, continue polling
    }
  }

  console.log('\n\n❌ Authentication timed out. Please try again.\n');
  process.exit(1);
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

export async function status(): Promise<void> {
  const config = await loadConfig();

  console.log('\n📊 Snowfort Status\n');

  if (!config.deviceToken) {
    console.log('Status: Not authenticated');
    console.log('\nRun "snowfort auth" to authenticate.\n');
    return;
  }

  console.log(`Status: Authenticated`);
  console.log(`Device: ${config.deviceName || 'Unknown'}`);
  console.log(`Relay:  ${config.relayUrl || DEFAULT_RELAY_URL}`);
  console.log(`Token:  ${config.deviceToken.slice(0, 12)}...`);
  console.log('');
}
