import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useStore } from '@/lib/store';
import { relay } from '@/lib/relay';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import Markdown from 'react-native-markdown-display';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessions, sessionMessages, setCurrentSession, clearMessages } = useStore();
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const session = sessions.find((s) => s.id === id);
  const messages = sessionMessages.get(id || '') || [];

  useEffect(() => {
    if (id) {
      setCurrentSession(id);
      // Clear local messages before subscribing - relay will replay history
      clearMessages(id);
      relay.subscribeToSession(id);

      return () => {
        relay.unsubscribeFromSession(id);
        setCurrentSession(null);
      };
    }
  }, [id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  function handleSend() {
    if (!input.trim() || !id) return;

    relay.sendInput(id, input.trim());
    setInput('');
  }

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Session not found</Text>
      </View>
    );
  }

  const statusColors = {
    running: '#4ade80',
    idle: '#facc15',
    ended: '#6b7280',
  };

  const markdownStyles = {
    body: { color: '#e5e7eb', fontSize: 15, lineHeight: 22 },
    code_inline: { backgroundColor: '#2a2a4a', color: '#a5b4fc', paddingHorizontal: 4, borderRadius: 4 },
    code_block: { backgroundColor: '#2a2a4a', padding: 12, borderRadius: 8, marginVertical: 8 },
    fence: { backgroundColor: '#2a2a4a', padding: 12, borderRadius: 8, marginVertical: 8 },
    link: { color: '#818cf8' },
    heading1: { color: '#fff', fontSize: 20, fontWeight: 'bold' as const, marginVertical: 8 },
    heading2: { color: '#fff', fontSize: 18, fontWeight: 'bold' as const, marginVertical: 6 },
    heading3: { color: '#fff', fontSize: 16, fontWeight: 'bold' as const, marginVertical: 4 },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { marginVertical: 2 },
    blockquote: { backgroundColor: '#1a1a2e', borderLeftWidth: 3, borderLeftColor: '#6366f1', paddingLeft: 12, marginVertical: 8 },
    table: { borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 4 },
    thead: { backgroundColor: '#2a2a4a' },
    th: { padding: 8, color: '#fff', fontWeight: 'bold' as const },
    tr: { borderBottomWidth: 1, borderBottomColor: '#2a2a4a' },
    td: { padding: 8, color: '#e5e7eb' },
  };

  // Custom rules to wrap tables in horizontal scroll
  const markdownRules = {
    table: (node: any, children: any, parent: any, styles: any) => (
      <View key={node.key} style={{ marginVertical: 8 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={{ flexGrow: 0 }}
          style={{ flexGrow: 0 }}
        >
          <View style={styles.table}>{children}</View>
        </ScrollView>
      </View>
    ),
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={styles.roleLabel}>{isUser ? 'You' : 'Claude'}</Text>
        {isUser ? (
          <Text style={styles.messageText}>{item.content}</Text>
        ) : (
          <View style={styles.markdownContainer}>
            <Markdown style={markdownStyles} rules={markdownRules}>{item.content}</Markdown>
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: session.name.length > 20 ? session.name.slice(0, 20) + '...' : session.name,
          headerRight: () => (
            <View style={[styles.statusDot, { backgroundColor: statusColors[session.status] }]} />
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        <View style={styles.pathBar}>
          <Text style={styles.pathText} numberOfLines={1}>
            {session.cwd}
          </Text>
          <View style={styles.statusBadge}>
            <View style={[styles.statusIndicator, { backgroundColor: statusColors[session.status] }]} />
            <Text style={styles.statusText}>{session.status}</Text>
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(_, index) => index.toString()}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Waiting for messages...</Text>
              <Text style={styles.emptySubtext}>Messages will appear here as the conversation progresses</Text>
            </View>
          }
        />

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Send a message..."
            placeholderTextColor="#6b7280"
            multiline
            maxLength={10000}
            editable={session.status !== 'ended'}
          />
          <TouchableOpacity
            style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || session.status === 'ended'}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  pathBar: {
    padding: 12,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pathText: {
    color: '#6b7280',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    color: '#9ca3af',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    paddingBottom: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#4b5563',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    maxWidth: '90%',
    overflow: 'hidden',
  },
  userBubble: {
    backgroundColor: '#6366f1',
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    backgroundColor: '#1a1a2e',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  roleLabel: {
    color: '#9ca3af',
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  messageText: {
    color: '#e5e7eb',
    fontSize: 15,
    lineHeight: 22,
  },
  markdownContainer: {
    flexShrink: 1,
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 32,
  },
});
