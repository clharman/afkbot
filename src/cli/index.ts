#!/usr/bin/env bun

import { run } from './run';
import { setup } from './setup';
import { auth, logout, getDeviceToken } from './auth';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'run': {
      // Find -- separator and get command after it
      const separatorIndex = args.indexOf('--');
      if (separatorIndex === -1) {
        console.error('Usage: snowfort run -- <command> [args...]');
        console.error('Example: snowfort run -- claude');
        process.exit(1);
      }
      const cmd = args.slice(separatorIndex + 1);
      if (cmd.length === 0) {
        console.error('No command specified after --');
        process.exit(1);
      }
      await run(cmd);
      break;
    }

    case 'auth': {
      if (args[1] === '--logout' || args[1] === 'logout') {
        await logout();
      } else if (args[1] === '--reset' || args[1] === 'reset') {
        await logout();
        await auth();
      } else {
        await auth();
      }
      break;
    }

    case 'setup': {
      await setup();
      break;
    }

    case 'daemon': {
      // Import and run daemon
      const { startDaemon } = await import('../daemon/index');
      await startDaemon();
      break;
    }

    case 'status': {
      const token = await getDeviceToken();
      if (token) {
        console.log('✓ Authenticated');
        console.log(`  Device token: ${token.slice(0, 12)}...`);
      } else {
        console.log('✗ Not authenticated');
        console.log('  Run "snowfort auth" to sign in.');
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined: {
      console.log(`
Snowfort - Remote access to local Claude Code sessions

Commands:
  auth               Authenticate with Snowfort
  auth --logout      Sign out
  auth --reset       Re-authenticate
  status             Show authentication status
  run -- <command>   Start a session with AgentAPI wrapper
  setup              Configure shell integration
  daemon             Run the background daemon
  help               Show this help message

Examples:
  snowfort auth
  snowfort run -- claude
  snowfort setup
`);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Run "snowfort help" for usage');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
