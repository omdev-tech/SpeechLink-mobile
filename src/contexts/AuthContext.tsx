import React, { createContext, useState, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../services/authService';
import { SecureStorageUnavailableError } from '../services/secureStorage';
import { apiService } from '../services/apiService';
import googleAuthService from '../services/googleAuthService';

interface AuthContextType {
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  loginWithGoogle: () => Promise<boolean>;
  token: string | null;
  isLoading: boolean;
  authError: string | null;
  isAuthenticatingWithGoogle: boolean;
}

export const AuthContext = createContext<AuthContextType>({
  signIn: async () => {},
  signOut: async () => {},
  loginWithGoogle: async () => false,
  token: null,
  isLoading: true,
  authError: null,
  isAuthenticatingWithGoogle: false
});

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticatingWithGoogle, setIsAuthenticatingWithGoogle] = useState(false);

  // Set up auth failure listener
  useEffect(() => {
    // Register callback for auth failures
    authService.onAuthenticationFailed(() => {
      console.log('Authentication failed, redirecting to login');
      setAuthError('Your session has expired. Please sign in again.');
      signOut();
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let subscription: { remove: () => void } | null = null;
    let lastAppState: AppStateStatus = AppState.currentState;

    /** @returns true when storage could be read (token or genuinely none), false if unreadable. */
    const loadStoredToken = async (): Promise<boolean> => {
      // A SecureStore read can fail transiently (iOS keychain locked right after a background
      // launch). That is "unknown", not "logged out": retry briefly and never clear the token.
      const retryDelaysMs = [300, 1000, 3000];
      for (let attempt = 0; ; attempt++) {
        try {
          const authToken = await authService.getToken();
          if (!cancelled) setUserToken(authToken?.access_token || null);
          return true;
        } catch (e) {
          if (e instanceof SecureStorageUnavailableError) {
            if (attempt < retryDelaysMs.length) {
              await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
              if (cancelled) return true;
              continue;
            }
            console.warn('[Auth] secure storage still unreadable; will retry when the app is next active');
            return false;
          }
          console.error('Failed to load auth token', e);
          return true;
        }
      }
    };

    const stopWatching = () => {
      subscription?.remove();
      subscription = null;
    };

    // Still unreadable after the retries: try again on the next background -> active
    // transition (e.g. once the device is unlocked) instead of stranding the user on login.
    const watchForForeground = () => {
      if (subscription) return;
      subscription = AppState.addEventListener('change', async (next: AppStateStatus) => {
        const becameActive = next === 'active' && lastAppState !== 'active';
        lastAppState = next;
        if (!becameActive || running || cancelled) return;
        running = true;
        const ok = await loadStoredToken();
        running = false;
        if (ok) stopWatching();
      });
    };

    const bootstrapAsync = async () => {
      running = true;
      const ok = await loadStoredToken();
      running = false;
      if (cancelled) return;
      setIsLoading(false);
      if (!ok) watchForForeground();
    };

    bootstrapAsync();
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, []);

  const signIn = async (token: string) => {
    try {
      if (!token) {
        console.error('Attempted to sign in with null/undefined token');
        setAuthError('Invalid authentication token');
        return;
      }
      
      // Instead of just saving the token string, create a proper token object
      const tokenObj = {
        access_token: token,
        token_type: 'bearer'
      };
      
      console.log('Signing in', { tokenLength: token.length });
      
      // Save the token using our auth service
      await authService.saveToken(tokenObj);
      
      // Update the state with the token
      setUserToken(token);
      setAuthError(null);
      
      // Reset auth failure flag when user logs in
      apiService.resetAuthFailureHandled();
      
      console.log('Successfully signed in and saved token');
    } catch (e) {
      console.error('Failed to save auth token', e);
      setAuthError('Failed to save authentication credentials');
    }
  };

  const signOut = async () => {
    try {
      await authService.clearToken();
      setUserToken(null);
    } catch (e) {
      console.error('Failed to remove auth token', e);
    }
  };

  // Function to authenticate with Google
  const loginWithGoogle = async (): Promise<boolean> => {
    try {
      setIsAuthenticatingWithGoogle(true);
      setAuthError(null);
      
      // Start the Google OAuth flow - no token needed for initial auth
      const result = await googleAuthService.startGoogleAuth(userToken || '');
      
      setIsAuthenticatingWithGoogle(false);
      
      if (!result.success) {
        setAuthError(result.message || 'Failed to authenticate with Google');
        return false;
      }
      
      // If we got a new token from Google auth, update it
      if (result.access_token) {
        await signIn(result.access_token);
      }
      
      return true;
    } catch (error) {
      console.error('Error in Google login:', error);
      setAuthError(error instanceof Error ? error.message : 'Failed to login with Google');
      setIsAuthenticatingWithGoogle(false);
      return false;
    }
  };

  const authContext = {
    signIn,
    signOut,
    loginWithGoogle,
    token: userToken,
    isLoading,
    authError,
    isAuthenticatingWithGoogle
  };

  if (isLoading) {
    // We could show a loading indicator here
    return null;
  }

  return (
    <AuthContext.Provider value={authContext}>
      {children}
    </AuthContext.Provider>
  );
}; 