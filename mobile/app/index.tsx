import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useStore } from '@/lib/store';
import { relay } from '@/lib/relay';
import { useState, useCallback } from 'react';
import type { Session } from '@/lib/types';

function SessionCard({ session, onPress }: { session: Session; onPress: () => void }) {
  const statusColors = {
    running: '#4ade80',
    idle: '#facc15',
    ended: '#6b7280',
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <Text style={styles.sessionName} numberOfLines={1}>
          {session.name}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColors[session.status] }]}>
          <Text style={styles.statusText}>{session.status}</Text>
        </View>
      </View>
      <Text style={styles.sessionPath} numberOfLines={1}>
        {session.cwd}
      </Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const { sessions, isConnected } = useStore();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    relay.refreshSessions();
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  if (!isSignedIn) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.title}>Snowfort</Text>
          <Text style={styles.subtitle}>Remote access to Claude Code</Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => router.push('/login')}
          >
            <Text style={styles.connectButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.connectionDot, { backgroundColor: isConnected ? '#4ade80' : '#ef4444' }]} />
          <Text style={styles.connectionText}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => signOut()}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No active sessions</Text>
          <Text style={styles.emptySubtext}>
            Start a Claude Code session on your computer
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              onPress={() => router.push(`/session/${item.id}`)}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  connectionText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  signOutText: {
    color: '#ef4444',
    fontSize: 14,
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  sessionPath: {
    color: '#6b7280',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 16,
    marginBottom: 32,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
