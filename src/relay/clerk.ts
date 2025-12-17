// Clerk JWT verification for relay server
import { createClerkClient, verifyToken } from '@clerk/backend';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export interface ClerkUser {
  userId: string;
  email?: string;
}

/**
 * Verify a Clerk session token (from mobile app)
 * Returns the user info if valid, null if invalid
 */
export async function verifyClerkToken(token: string): Promise<ClerkUser | null> {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    return {
      userId: payload.sub,
      email: payload.email as string | undefined,
    };
  } catch (error) {
    console.error('[Clerk] Token verification failed:', error);
    return null;
  }
}

/**
 * Get user details from Clerk
 */
export async function getClerkUser(userId: string) {
  try {
    return await clerkClient.users.getUser(userId);
  } catch (error) {
    console.error('[Clerk] Failed to get user:', error);
    return null;
  }
}

export { clerkClient };
