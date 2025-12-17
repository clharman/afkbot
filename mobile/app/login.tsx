import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [pendingVerification, setPendingVerification] = useState(false);

  async function handleSignIn() {
    if (!signInLoaded || !email.trim() || !password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password: password.trim(),
      });

      if (result.status === 'complete') {
        await setSignInActive({ session: result.createdSessionId });
        router.back();
      } else {
        setError('Sign in incomplete. Please try again.');
      }
    } catch (err: any) {
      console.error('Sign in error:', err);
      setError(err.errors?.[0]?.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    if (!signUpLoaded || !email.trim() || !password.trim()) return;

    setLoading(true);
    setError('');

    try {
      await signUp.create({
        emailAddress: email.trim(),
        password: password.trim(),
      });

      // Send verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
      setError('');
    } catch (err: any) {
      console.error('Sign up error:', err);
      setError(err.errors?.[0]?.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!signUpLoaded || !code.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });

      if (result.status === 'complete') {
        await setSignUpActive({ session: result.createdSessionId });
        router.back();
      } else {
        setError('Verification incomplete. Please try again.');
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      setError(err.errors?.[0]?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  // Verification code entry screen
  if (pendingVerification) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Verify Email</Text>
        <Text style={styles.subtitle}>
          Enter the verification code sent to {email}
        </Text>
        <Text style={styles.hint}>
          For test emails (+clerk_test), use code: 424242
        </Text>

        <Text style={styles.label}>Verification Code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="Enter code"
          placeholderTextColor="#6b7280"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleVerifyCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchMode}
          onPress={() => {
            setPendingVerification(false);
            setCode('');
            setError('');
          }}
        >
          <Text style={styles.switchModeText}>Back to Sign Up</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleSubmit = mode === 'signin' ? handleSignIn : handleSignUp;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
      </Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="your@email.com"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.switchMode}
        onPress={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError('');
        }}
      >
        <Text style={styles.switchModeText}>
          {mode === 'signin'
            ? "Don't have an account? Sign Up"
            : 'Already have an account? Sign In'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    color: '#6366f1',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 16,
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchMode: {
    marginTop: 24,
    alignItems: 'center',
  },
  switchModeText: {
    color: '#6366f1',
    fontSize: 14,
  },
});
