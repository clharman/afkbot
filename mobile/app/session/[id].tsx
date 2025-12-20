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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useStore } from '@/lib/store';
import { relay } from '@/lib/relay';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, TodoItem } from '@/lib/types';
import Markdown from 'react-native-markdown-display';
// Speech recognition - may not be available in Expo Go
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = () => {};

try {
  const speechModule = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = speechModule.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = speechModule.useSpeechRecognitionEvent;
} catch {
  // Module not available (e.g., in Expo Go)
}

// Collapsible Todo Section component
function TodoSection({ todos }: { todos: TodoItem[] }) {
  const [expanded, setExpanded] = useState(true);

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const pending = todos.filter((t) => t.status === 'pending').length;

  const statusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return <Ionicons name="checkmark-circle" size={16} color="#4ade80" />;
      case 'in_progress':
        return <Ionicons name="sync" size={16} color="#818cf8" />;
      case 'pending':
        return <Ionicons name="ellipse-outline" size={16} color="#6b7280" />;
    }
  };

  return (
    <View style={todoStyles.container}>
      <TouchableOpacity
        style={todoStyles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={todoStyles.headerLeft}>
          <Ionicons name="list" size={16} color="#818cf8" />
          <Text style={todoStyles.headerTitle}>Tasks</Text>
          <View style={todoStyles.badge}>
            <Text style={todoStyles.badgeText}>
              {completed}/{todos.length}
            </Text>
          </View>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#6b7280"
        />
      </TouchableOpacity>

      {expanded && (
        <View style={todoStyles.list}>
          {todos.map((todo, index) => (
            <View key={index} style={todoStyles.item}>
              {statusIcon(todo.status)}
              <Text
                style={[
                  todoStyles.itemText,
                  todo.status === 'completed' && todoStyles.completedText,
                  todo.status === 'in_progress' && todoStyles.inProgressText,
                ]}
                numberOfLines={2}
              >
                {todo.status === 'in_progress' && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessions, sessionMessages, sessionTodos, setCurrentSession, clearMessages, clearTodos } = useStore();
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Speech recognition event handlers
  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('result', (event) => {
    // Get the latest transcript
    const transcript = event.results[event.results.length - 1]?.transcript;
    if (transcript) {
      setInput((prev) => prev + (prev ? ' ' : '') + transcript);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.error('Speech recognition error:', event.error);
    setIsListening(false);
    Alert.alert('Voice Input Error', event.error);
  });

  const speechAvailable = ExpoSpeechRecognitionModule !== null;

  async function toggleListening() {
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert('Not Available', 'Voice input requires a development build. It is not available in Expo Go.');
      return;
    }

    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
    } else {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert('Permission Required', 'Microphone permission is needed for voice input.');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
    }
  }

  const session = sessions.find((s) => s.id === id);
  const messages = sessionMessages.get(id || '') || [];
  const todos = sessionTodos.get(id || '') || [];

  useEffect(() => {
    if (id) {
      setCurrentSession(id);
      // Clear local messages and todos before subscribing - relay will replay history
      clearMessages(id);
      clearTodos(id);
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

        <TodoSection todos={todos} />

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
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={isListening ? "Listening..." : "Send a message..."}
            placeholderTextColor={isListening ? "#818cf8" : "#6b7280"}
            multiline
            maxLength={10000}
            editable={session.status !== 'ended'}
          />
          {input.trim() || inputFocused ? (
            <TouchableOpacity
              style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || session.status === 'ended'}
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.micButton,
                isListening && styles.micButtonActive,
                !speechAvailable && styles.micButtonDisabled
              ]}
              onPress={toggleListening}
              disabled={session.status === 'ended'}
            >
              <Ionicons name={isListening ? "stop" : "mic"} size={20} color="#fff" />
            </TouchableOpacity>
          )}
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
  micButton: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    marginRight: 8,
  },
  micButtonActive: {
    backgroundColor: '#ef4444',
  },
  micButtonDisabled: {
    opacity: 0.4,
  },
  micButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
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

const todoStyles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '500',
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemText: {
    color: '#9ca3af',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  completedText: {
    color: '#6b7280',
    textDecorationLine: 'line-through',
  },
  inProgressText: {
    color: '#e5e7eb',
  },
});
