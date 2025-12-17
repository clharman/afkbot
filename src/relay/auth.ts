// Authentication service using Clerk + device tokens
import { verifyClerkToken, type ClerkUser } from './clerk';
import { getDeviceByToken, getOrCreateUser, type DbUser, type DbDevice } from './db';

export interface AuthResult {
  success: boolean;
  userId?: string;       // Internal UUID
  clerkId?: string;      // Clerk user ID
  deviceId?: string;     // Device UUID (for daemon connections)
  error?: string;
}

class AuthService {
  /**
   * Authenticate a mobile client using Clerk session token
   */
  async authenticateMobile(token: string): Promise<AuthResult> {
    // Verify with Clerk
    const clerkUser = await verifyClerkToken(token);
    if (!clerkUser) {
      return { success: false, error: 'Invalid session token' };
    }

    // Get or create user in our database
    const user = await getOrCreateUser(clerkUser.userId, clerkUser.email);
    if (!user) {
      return { success: false, error: 'Failed to create user' };
    }

    return {
      success: true,
      userId: user.id,
      clerkId: clerkUser.userId,
    };
  }

  /**
   * Authenticate a daemon using device token
   */
  async authenticateDaemon(token: string): Promise<AuthResult> {
    // Device tokens start with 'sfd_'
    if (!token.startsWith('sfd_')) {
      return { success: false, error: 'Invalid device token format' };
    }

    const device = await getDeviceByToken(token);
    if (!device) {
      return { success: false, error: 'Unknown device' };
    }

    return {
      success: true,
      userId: device.user_id,
      deviceId: device.id,
    };
  }

  /**
   * Authenticate based on token type (auto-detect)
   */
  async authenticate(token: string, clientType: 'mobile' | 'daemon'): Promise<AuthResult> {
    if (clientType === 'daemon') {
      return this.authenticateDaemon(token);
    }
    return this.authenticateMobile(token);
  }
}

export const authService = new AuthService();

// For backwards compatibility during development
// TODO: Remove this once Clerk is fully integrated
const DEV_MODE = process.env.NODE_ENV !== 'production';
if (DEV_MODE) {
  console.log('[Auth] Running in development mode - test tokens enabled');
}

export function isDevToken(token: string): boolean {
  return DEV_MODE && token === 'test-token-123';
}
