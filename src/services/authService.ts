import * as secureStorage from './secureStorage';
import { API_CONFIG } from '../config/api';
import { 
  login, 
  register, 
  refreshTokens, 
  requestPasswordReset, 
  resetPassword, 
  logout as apiLogout 
} from '../api/auth';
import { 
  LoginCredentials, 
  RegisterCredentials, 
  AuthResponse, 
  PasswordResetConfirm 
} from '../types/auth';

export interface AuthToken {
  access_token: string;
  expires_in?: number;
  expires_at?: number;   // unix seconds
  token_type?: string;
  accessToken?: string;  // Alternative NextAuth format
  userId?: string;       // User ID extracted from token
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// Define callbacks to be used for auth events
type AuthEventCallback = () => void;

/**
 * Result of a refresh attempt.
 *  - refreshed: a new token (and expiry) is stored
 *  - invalid:   the server rejected the session (401): token cleared, auth-failed callbacks fired
 *  - transient: rate limited / server error / offline / backing off: the token is KEPT
 *  - no_token:  nobody is signed in
 */
export type RefreshOutcome = 'refreshed' | 'invalid' | 'transient' | 'no_token';

const DAY_S = 24 * 60 * 60;
/** Refresh proactively once fewer than this many seconds remain before expiry. */
export const REFRESH_WINDOW_S = 30 * DAY_S;
/** Expiry assumed when the server does not send one (current backend issues 30-day tokens). */
export const UNKNOWN_EXPIRY_S = 25 * DAY_S;
/** Don't proactively refresh the same session more often than this (e.g. estimated expiries). */
export const MIN_PROACTIVE_INTERVAL_S = DAY_S;
const DEFAULT_BACKOFF_S = 30;
const MAX_BACKOFF_S = 30 * 60;

const nowS = () => Math.floor(Date.now() / 1000);

/** Expiry bookkeeping for a token the server just issued. */
export function tokenMetaFrom(data: { expires_at?: unknown; expires_in?: unknown }): secureStorage.TokenMeta {
  const obtainedAt = nowS();
  const expiresAt = Number(data?.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt > 0) return { expiresAt, obtainedAt, estimated: false };
  const expiresIn = Number(data?.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) return { expiresAt: obtainedAt + expiresIn, obtainedAt, estimated: false };
  return { expiresAt: obtainedAt + UNKNOWN_EXPIRY_S, obtainedAt, estimated: true };
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

class AuthService {
  private static instance: AuthService;
  private token: AuthToken | null = null;
  private tokenRefreshInProgress: boolean = false;
  private authFailedCallbacks: AuthEventCallback[] = [];
  private refreshPromise: Promise<RefreshOutcome> | null = null;
  private proactivePromise: Promise<RefreshOutcome | 'not_needed'> | null = null;
  /** Bumped whenever the session is replaced or ended, so a late refresh response can't resurrect it. */
  private sessionGeneration = 0;
  /** Backoff after transient refresh failures (Retry-After or exponential), in ms since epoch. */
  private nextRefreshAllowedAt = 0;
  private consecutiveRefreshFailures = 0;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // Register a callback for when authentication fails
  public onAuthenticationFailed(callback: AuthEventCallback): void {
    this.authFailedCallbacks.push(callback);
  }

  // Trigger auth failed callbacks
  public triggerAuthFailedCallbacks(): void {
    this.authFailedCallbacks.forEach(callback => callback());
  }

  /**
   * Login with email and password
   */
  public async loginWithCredentials(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      // Call the login API
      const response = await login(credentials);
      
      // Format and save the token
      const tokenObj: AuthToken = {
        access_token: response.accessToken || response.access_token || '',
        token_type: 'bearer',
        expires_in: response.expires_in,
        expires_at: response.expires_at,
        user: response.user,
        userId: response.user?.id
      };
      
      await this.saveToken(tokenObj);
      return response;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  /**
   * Register a new user
   */
  public async registerUser(credentials: RegisterCredentials): Promise<AuthResponse> {
    try {
      const response = await register(credentials);
      return response;
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  public async requestPasswordReset(email: string): Promise<{success: boolean}> {
    try {
      return await requestPasswordReset(email);
    } catch (error) {
      console.error('Password reset request failed:', error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  public async resetPassword(resetData: PasswordResetConfirm): Promise<{success: boolean}> {
    try {
      return await resetPassword(resetData);
    } catch (error) {
      console.error('Password reset failed:', error);
      throw error;
    }
  }

  /**
   * Logout the user
   */
  public async logout(): Promise<void> {
    try {
      // Call the logout API
      await apiLogout();
    } catch (error) {
      console.error('Logout API call failed:', error);
      // Continue with local cleanup even if API call fails
    }
    
    // Clear stored tokens
    await this.clearToken();
  }

  /**
   * Refresh the session token (POST /api/auth/mobile/refresh). Single-flight: concurrent callers
   * share one request. Only a 401 ends the session; 429/5xx/network errors keep the token and back
   * off (honouring Retry-After).
   * @throws SecureStorageUnavailableError when the token can't be read right now (NOT a logout).
   */
  public refreshSession(): Promise<RefreshOutcome> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /** @deprecated use refreshSession(); kept for callers that only need a boolean. */
  public async refreshAccessToken(): Promise<boolean> {
    return (await this.refreshSession()) === 'refreshed';
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    const currentToken = await this.getToken(); // may throw SecureStorageUnavailableError
    if (!currentToken?.access_token) return 'no_token';
    if (Date.now() < this.nextRefreshAllowedAt) return 'transient';

    const generation = this.sessionGeneration;
    let response: Response;
    try {
      response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile-app' },
        body: JSON.stringify({ token: currentToken.access_token }),
      });
    } catch (error) {
      console.warn('[Auth] Token refresh: network error, keeping the session');
      return this.backOff(null);
    }

    if (generation !== this.sessionGeneration) return 'transient'; // signed out / replaced meanwhile

    if (response.status === 401) {
      console.warn('[Auth] Token refresh rejected (401): session ended');
      await this.clearToken();
      this.triggerAuthFailedCallbacks();
      return 'invalid';
    }

    if (!response.ok) {
      // 429 / 503 (Retry-After), other 5xx (the current backend answers 500 for expired tokens), 400...
      console.warn('[Auth] Token refresh failed transiently, keeping the session:', response.status);
      return this.backOff(retryAfterSeconds(response));
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!data?.access_token || typeof data.access_token !== 'string') {
      console.warn('[Auth] Token refresh: malformed response, keeping the session');
      return this.backOff(null);
    }
    if (generation !== this.sessionGeneration) return 'transient';

    await this.persistToken({
      access_token: data.access_token,
      token_type: 'bearer',
      expires_in: data.expires_in,
      expires_at: data.expires_at,
      user: data.user,
    });
    this.nextRefreshAllowedAt = 0;
    this.consecutiveRefreshFailures = 0;
    console.log('[Auth] Token refresh successful');
    return 'refreshed';
  }

  private backOff(retryAfterS: number | null): RefreshOutcome {
    this.consecutiveRefreshFailures += 1;
    const exponential = Math.min(DEFAULT_BACKOFF_S * 2 ** (this.consecutiveRefreshFailures - 1), MAX_BACKOFF_S);
    const delayS = retryAfterS != null ? Math.min(retryAfterS, MAX_BACKOFF_S) : exponential;
    this.nextRefreshAllowedAt = Date.now() + delayS * 1000;
    return 'transient';
  }

  /**
   * Proactive refresh, run on launch and when the app returns to the foreground: refresh when the
   * token expires within REFRESH_WINDOW_S, or when its expiry is unknown (token stored before expiry
   * tracking existed). Never throws.
   */
  public refreshIfNeeded(): Promise<RefreshOutcome | 'not_needed'> {
    if (!this.proactivePromise) {
      this.proactivePromise = this.doRefreshIfNeeded().finally(() => {
        this.proactivePromise = null;
      });
    }
    return this.proactivePromise;
  }

  private async doRefreshIfNeeded(): Promise<RefreshOutcome | 'not_needed'> {
    try {
      const token = await this.getToken();
      if (!token?.access_token) return 'no_token';
      const meta = await secureStorage.getTokenMeta();
      if (meta) {
        const now = nowS();
        if (meta.expiresAt - now >= REFRESH_WINDOW_S) return 'not_needed';
        if (now - meta.obtainedAt < MIN_PROACTIVE_INTERVAL_S) return 'not_needed';
      }
      return await this.refreshSession();
    } catch (error) {
      // e.g. keychain locked: unknown, not logged out — try again next time.
      console.warn('[Auth] proactive refresh skipped:', error instanceof Error ? error.name : 'error');
      return 'transient';
    }
  }

  /**
   * End every session of this account (all devices, this one included): POST /api/auth/logout-all.
   * On success (or 401: already gone) the local session is cleared. Any other failure throws and
   * keeps this session, since the other devices were NOT signed out.
   */
  public async logoutEverywhere(): Promise<void> {
    const token = await this.getToken();
    if (!token?.access_token) {
      await this.clearToken();
      return;
    }
    const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/logout-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'mobile-app',
        Authorization: `Bearer ${token.access_token}`,
      },
    });
    if (!response.ok && response.status !== 401) {
      throw new Error(`logout-all failed: ${response.status}`);
    }
    await this.clearToken();
  }

  public async getDevelopmentToken(): Promise<AuthToken> {
    try {
      // Prevent multiple concurrent token refresh attempts
      if (this.tokenRefreshInProgress) {
        // Wait for existing refresh to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.token) {
          console.log('Using cached dev token (token refresh in progress)');
          return this.token;
        }
      }

      this.tokenRefreshInProgress = true;
      console.log('Fetching development token...');
      
      try {
        console.log(`Making request to: ${API_CONFIG.BASE_URL}/api/dev-auth`);
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/dev-auth`);
        
        console.log('Dev auth response status:', response.status);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch development token: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Dev token response structure:', Object.keys(data));
        
        // Only update if we actually got a token
        if (data && data.access_token) {
          // Add additional fields required by NextAuth format
          const enhancedToken = {
            ...data,
            // Add token_type if missing
            token_type: data.token_type || 'bearer',
            // Format field that NextAuth might expect
            accessToken: data.access_token,
            userId: data.user?.id
          };
          
          this.token = enhancedToken;
          await this.saveToken(enhancedToken);
          console.log('Successfully saved development token with enhanced fields');
          return enhancedToken;
        } else {
          console.error('Invalid token response - missing access_token; keys:', Object.keys(data || {}));
          throw new Error('Invalid token response');
        }
      } catch (error) {
        console.error('Error fetching development token:', error);
        // Trigger auth failed callbacks on serious errors
        this.triggerAuthFailedCallbacks();
        throw error;
      } finally {
        this.tokenRefreshInProgress = false;
      }
    } catch (error) {
      console.error('Error in getDevelopmentToken:', error);
      throw error;
    }
  }

  public async getToken(): Promise<AuthToken | null> {
    if (this.token) {
      return this.token;
    }

    try {
      const storedToken = await secureStorage.getToken();
      if (storedToken) {
        this.token = { access_token: storedToken, token_type: 'bearer' };
        return this.token;
      }
    } catch (error) {
      // "Unknown" (keychain locked...) must not look like "logged out" to callers.
      if (error instanceof secureStorage.SecureStorageUnavailableError) throw error;
      console.error('Error retrieving stored token:', error);
    }

    return null;
  }

  /** Store a token obtained from a sign-in (replaces the current session). */
  public async saveToken(token: AuthToken): Promise<void> {
    this.sessionGeneration += 1;
    this.nextRefreshAllowedAt = 0;
    this.consecutiveRefreshFailures = 0;
    await this.persistToken(token);
  }

  private async persistToken(token: AuthToken): Promise<void> {
    try {
      this.token = token;
      if (!token.access_token) {
        console.warn('Warning: Token is missing access_token field');
      }
      await secureStorage.setToken(token.access_token, tokenMetaFrom(token));
    } catch (error) {
      console.error('Error saving token:', error);
    }
  }

  public async clearToken(): Promise<void> {
    try {
      this.sessionGeneration += 1;
      this.token = null;
      await secureStorage.clearTokens();
    } catch (error) {
      console.error('Error clearing token:', error);
    }
  }

  public async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }

  // Handle an auth error by clearing token and redirecting
  public async handleAuthError(): Promise<void> {
    // Clear the token since it's invalid
    await this.clearToken();
    // Notify listeners that auth has failed
    this.triggerAuthFailedCallbacks();
  }

  /** Test-only: forget all in-memory session state (simulates a cold start). */
  public __resetSessionStateForTests(): void {
    this.token = null;
    this.refreshPromise = null;
    this.proactivePromise = null;
    this.nextRefreshAllowedAt = 0;
    this.consecutiveRefreshFailures = 0;
    this.authFailedCallbacks = [];
  }
}

export const authService = AuthService.getInstance(); 