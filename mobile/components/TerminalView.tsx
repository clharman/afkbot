import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export interface TerminalViewRef {
  write: (data: string) => void;
  clear: () => void;
}

interface TerminalViewProps {
  onInput?: (text: string) => void;
}

const TERMINAL_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      background: #0f0f1a;
      overflow: hidden;
    }
    #terminal {
      height: 100%;
      width: 100%;
    }
    .xterm {
      height: 100%;
      padding: 8px;
    }
    .xterm-viewport {
      overflow-y: auto !important;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
  <script>
    const term = new Terminal({
      theme: {
        background: '#0f0f1a',
        foreground: '#e5e5e5',
        cursor: '#6366f1',
        cursorAccent: '#0f0f1a',
        selectionBackground: '#6366f1',
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e5e5e5',
        brightBlack: '#6b7280',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: false,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));

    // Fit terminal to container
    setTimeout(() => fitAddon.fit(), 100);
    window.addEventListener('resize', () => fitAddon.fit());

    // Handle input from terminal (user typing)
    term.onData((data) => {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', data }));
    });

    // Handle messages from React Native
    window.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'write') {
          term.write(msg.data);
        } else if (msg.type === 'clear') {
          term.clear();
        } else if (msg.type === 'fit') {
          fitAddon.fit();
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    // Also handle for Android
    document.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'write') {
          term.write(msg.data);
        } else if (msg.type === 'clear') {
          term.clear();
        } else if (msg.type === 'fit') {
          fitAddon.fit();
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    // Signal ready
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  </script>
</body>
</html>
`;

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  ({ onInput }, ref) => {
    const webViewRef = useRef<WebView>(null);
    const isReady = useRef(false);
    const pendingWrites = useRef<string[]>([]);

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        if (isReady.current && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ type: 'write', data }));
        } else {
          pendingWrites.current.push(data);
        }
      },
      clear: () => {
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ type: 'clear' }));
        }
      },
    }));

    const handleMessage = (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'ready') {
          isReady.current = true;
          // Write any pending data
          pendingWrites.current.forEach(data => {
            webViewRef.current?.postMessage(JSON.stringify({ type: 'write', data }));
          });
          pendingWrites.current = [];
        } else if (msg.type === 'input' && onInput) {
          onInput(msg.data);
        }
      } catch (e) {
        console.error('Failed to parse WebView message:', e);
      }
    };

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html: TERMINAL_HTML }}
          style={styles.webview}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={['*']}
          scrollEnabled={false}
          bounces={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
});
