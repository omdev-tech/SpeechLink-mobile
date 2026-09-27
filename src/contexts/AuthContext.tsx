import React, { createContext, useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService, AuthToken } from '../services/authService';
import { SecureStorageUnavailableError } from '../services/secureStorage';
import googleAuthService from '../services/googleAuthService';

/** Expiry fields of a login / register / Google verify response (all optional). */
export type TokenExpiryInfo = Pick<AuthToken, 'expires_in' | 'expires_at'>;

interface AuthContextType {
  signIn: (token: string, expiry?: TokenExpiryInfo) => Promise<void>;
  signOut: () => Promise<void>;
  /** End every session of this account (all devices). Throws (and keeps this session) on failure. */
  signOutEverywhere: () => Promise<void>;
  /** The backend that issued this session supports logging out everywhere (hide the UI otherwise). */
  canSignOutEverywhere: boolean;
  loginWithGoogle: () => Promise<boolean>;
  token: string | null;
  isLoading: boolean;
  authError: string | null;
  isAuthenticatingWithGoogle: boolean;
}

export const AuthContext = createContext<AuthContextType>({
  signIn: async () => {},
  signOut: async () => {},
  signOutEverywhere: async () => {},
  canSignOutEverywhere: false,
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
  const [canSignOutEverywhere, setCanSignOutEverywhere] = useState(false);
  const userTokenRef = useRef<string | null>(null);
  userTokenRef.current = userToken;
  const signingOutRef = useRef(false);

  // Set up auth failure listener. Idempotent: several in-flight requests may all report the dead
  // session; sign out once, and not at all when already signed out.
  useEffect(() => {
    authService.onAuthenticationFailed(async () => {
      if (!userTokenRef.current || signingOutRef.current) return;
      signingOutRef.current = true;
      console.log('Authentication failed, redirecting to login');
      setAuthError('Your session has expired. Please sign in again.');
      try {
        await signOut();
      } finally {
        signingOutRef.current = false;
      }
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

  // Proactive token refresh: on launch (once signed in) and whenever the app returns to the
  // foreground. authService decides whether a refresh is due and never signs out on transient
  // failures; a rejected session (401) goes through onAuthenticationFailed above.
  const isSignedIn = !!userToken;
  const refreshCheckRunning = useRef(false);
  useEffect(() => {
    if (!isSignedIn) return;
    let active = true;
    let lastAppState: AppStateStatus = AppState.currentState;

    const check = async () => {
      if (refreshCheckRunning.current) return;
      refreshCheckRunning.current = true;
      try {
        const outcome = await authService.refreshIfNeeded();
        if (outcome === 'refreshed' && active) {
          const refreshed = await authService.getToken();
          if (active && refreshed?.access_token) setUserToken(refreshed.access_token);
        }
      } catch (e) {
        console.warn('[Auth] proactive refresh check failed');
      } finally {
        refreshCheckRunning.current = false;
      }
    };

    check();
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const becameActive = next === 'active' && lastAppState !== 'active';
      lastAppState = next;
      if (becameActive) check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [isSignedIn]);

  // Log-out-everywhere capability follows the current session (new backend vs current prod).
  useEffect(() => {
    if (!userToken) {
      setCanSignOutEverywhere(false);
      return;
    }
    let active = true;
    Promise.resolve(authService.canLogoutEverywhere?.())
      .then((supported) => {
        if (active) setCanSignOutEverywhere(!!supported);
      })
      .catch(() => {
        if (active) setCanSignOutEverywhere(false);
      });
    return () => {
      active = false;
    };
  }, [userToken]);

  const signIn = async (token: string, expiry?: TokenExpiryInfo) => {
    try {
      if (!token) {
        console.error('Attempted to sign in with null/undefined token');
        setAuthError('Invalid authentication token');
        return;
      }
      
      // Instead of just saving the token string, create a proper token object
      const tokenObj: AuthToken = {
        access_token: token,
        token_type: 'bearer',
        expires_in: expiry?.expires_in,
        expires_at: expiry?.expires_at,
      };
      
      console.log('Signing in', { tokenLength: token.length });
      
      // Save the token using our auth service
      await authService.saveToken(tokenObj);
      
      // Update the state with the token
      setUserToken(token);
      setAuthError(null);
      
      console.log('Successfully signed in and saved token');
    } catch (e) {
      console.error('Failed to save auth token', e);
      setAuthError('Failed to save authentication credentials');
    }
  };

  const signOut = async () => {
    try {
      await authService.clearToken();
      userTokenRef.current = null;
      setUserToken(null);
    } catch (e) {
      console.error('Failed to remove auth token', e);
    }
  };

  const signOutEverywhere = async () => {
    await authService.logoutEverywhere(); // throws -> this session is kept, caller shows the error
    setUserToken(null);
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
        await signIn(result.access_token, result);
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
    signOutEverywhere,
    canSignOutEverywhere,
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