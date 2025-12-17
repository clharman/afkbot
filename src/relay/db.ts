// Supabase client for relay server
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
// Use secret key for server-side operations (new format as of 2025)
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;

export const supabase = createClient(supabaseUrl, supabaseSecretKey);

// Database types
export interface DbUser {
  id: string;
  clerk_id: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbDevice {
  id: string;
  user_id: string;
  name: string;
  device_token: string;
  last_seen_at: string | null;
  created_at: string;
}

export interface DbSession {
  id: string;
  device_id: string;
  user_id: string;
  session_id: string;
  name: string | null;
  cwd: string | null;
  status: 'running' | 'idle' | 'ended';
  started_at: string;
  ended_at: string | null;
}

export interface DbPushToken {
  id: string;
  user_id: string;
  token: string;
  platform: string | null;
  created_at: string;
}

// User operations
export async function getOrCreateUser(clerkId: string, email?: string): Promise<DbUser | null> {
  // Try to find existing user
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', clerkId)
    .single();

  if (existing) {
    return existing as DbUser;
  }

  // Create new user
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ clerk_id: clerkId, email })
    .select()
    .single();

  if (error) {
    console.error('[DB] Failed to create user:', error);
    return null;
  }

  return newUser as DbUser;
}

export async function getUserByClerkId(clerkId: string): Promise<DbUser | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', clerkId)
    .single();

  return data as DbUser | null;
}

// Device operations
export async function getDeviceByToken(token: string): Promise<(DbDevice & { user: DbUser }) | null> {
  const { data } = await supabase
    .from('devices')
    .select('*, user:users(*)')
    .eq('device_token', token)
    .single();

  if (!data) return null;

  // Update last seen
  await supabase
    .from('devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id);

  return data as DbDevice & { user: DbUser };
}

export async function createDevice(userId: string, name: string): Promise<DbDevice | null> {
  // Generate a secure device token
  const deviceToken = generateDeviceToken();

  const { data, error } = await supabase
    .from('devices')
    .insert({
      user_id: userId,
      name,
      device_token: deviceToken,
    })
    .select()
    .single();

  if (error) {
    console.error('[DB] Failed to create device:', error);
    return null;
  }

  return data as DbDevice;
}

export async function getDevicesForUser(userId: string): Promise<DbDevice[]> {
  const { data } = await supabase
    .from('devices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data || []) as DbDevice[];
}

// Session operations
export async function createSession(
  deviceId: string,
  userId: string,
  sessionId: string,
  name: string,
  cwd: string
): Promise<DbSession | null> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      device_id: deviceId,
      user_id: userId,
      session_id: sessionId,
      name,
      cwd,
      status: 'running',
    })
    .select()
    .single();

  if (error) {
    console.error('[DB] Failed to create session:', error);
    return null;
  }

  return data as DbSession;
}

export async function updateSessionStatus(
  sessionId: string,
  status: 'running' | 'idle' | 'ended'
): Promise<void> {
  const update: Record<string, any> = { status };
  if (status === 'ended') {
    update.ended_at = new Date().toISOString();
  }

  await supabase
    .from('sessions')
    .update(update)
    .eq('session_id', sessionId);
}

export async function getActiveSessions(userId: string): Promise<DbSession[]> {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'ended')
    .order('started_at', { ascending: false });

  return (data || []) as DbSession[];
}

// Push token operations
export async function savePushToken(
  userId: string,
  token: string,
  platform?: string
): Promise<void> {
  await supabase
    .from('push_tokens')
    .upsert({
      user_id: userId,
      token,
      platform,
    }, {
      onConflict: 'user_id,token',
    });
}

export async function getPushTokens(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId);

  return (data || []).map(d => d.token);
}

export async function deletePushToken(userId: string, token: string): Promise<void> {
  await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token);
}

// Session tracking
export async function trackSession(userId: string, sessionId: string): Promise<void> {
  // Get the session's UUID from session_id
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('session_id', sessionId)
    .single();

  if (session) {
    await supabase
      .from('tracked_sessions')
      .upsert({
        user_id: userId,
        session_id: session.id,
      }, {
        onConflict: 'user_id,session_id',
      });
  }
}

export async function untrackSession(userId: string, sessionId: string): Promise<void> {
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('session_id', sessionId)
    .single();

  if (session) {
    await supabase
      .from('tracked_sessions')
      .delete()
      .eq('user_id', userId)
      .eq('session_id', session.id);
  }
}

export async function isSessionTracked(userId: string, sessionId: string): Promise<boolean> {
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('session_id', sessionId)
    .single();

  if (!session) return false;

  const { data } = await supabase
    .from('tracked_sessions')
    .select('user_id')
    .eq('user_id', userId)
    .eq('session_id', session.id)
    .single();

  return !!data;
}

// Helper to generate secure device tokens
function generateDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'sfd_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
