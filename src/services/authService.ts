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
 *  - invalid:   the session is dead: token cleared, auth-failed callbacks fired (once)
 *  - transient: rate limited / offline / backing off / not yet persisted: the token is KEPT
 *  - no_token:  nobody is signed in
 */
export type RefreshOutcome = 'refreshed' | 'invalid' | 'transient' | 'no_token';

/**
 * Why a refresh is attempted. 'api401': an API route already rejected the token, so any refresh
 * failure other than 429/503/network is final. 'proactive': the token still worked, so a server
 * error only ends the session once the token's (possibly estimated) expiry has passed.
 */
export type RefreshReason = 'proactive' | 'api401';

/** Raw result of one refresh request, shared by every concurrent caller (interpreted per reason). */
type RawRefresh =
  | { kind: 'ok' }
  | { kind: 'no_token' }
  | { kind: 'superseded' } // the session was ended/replaced while the request was in flight
  | { kind: 'unpersisted' } // new token only in memory (storage write failed; retried later)
  | { kind: 'rejected'; generation: number } // 401
  | { kind: 'retryable'; generation: number } // 429 / 503 / network: never ends the session
  | { kind: 'failed'; generation: number }; // any other non-2xx, malformed 200

/** The backend has no /api/auth/logout-all yet (404). */
export interface DeleteAccountRequest {
  appleAuthorizationCode?: string;
  appleUnavailable?: boolean;
  lang?: string;
}

export type DeleteAccountOutcome =
  | { status: 'deleted' }
  | { status: 'appleReauthRequired' }
  /** The user closed the Apple confirmation sheet: nothing was deleted, nothing to report. */
  | { status: 'canceled' }
  | { status: 'failed'; code: string };

export class LogoutEverywhereUnavailableError extends Error {
  constructor() {
    super('logout-all is not available on this server');
    this.name = 'LogoutEverywhereUnavailableError';
  }
}

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
  // Only the session-revocation backend sends expires_at; it is also the one with logout-all.
  if (Number.isFinite(expiresAt) && expiresAt > 0) return { expiresAt, obtainedAt, estimated: false, logoutAllSupported: true };
  const expiresIn = Number(data?.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return { expiresAt: obtainedAt + expiresIn, obtainedAt, estimated: false, logoutAllSupported: false };
  }
  return { expiresAt: obtainedAt + UNKNOWN_EXPIRY_S, obtainedAt, estimated: true, logoutAllSupported: false };
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
  private refreshPromise: Promise<RawRefresh> | null = null;
  private proactivePromise: Promise<RefreshOutcome | 'not_needed'> | null = null;
  /** Bumped whenever the session is replaced or ended, so a late refresh response can't resurrect it. */
  private sessionGeneration = 0;
  /** Backoff after transient refresh failures (Retry-After or exponential), in ms since epoch. */
  private nextRefreshAllowedAt = 0;
  private consecutiveRefreshFailures = 0;
  private lastRefreshFailure: 'retryable' | 'failed' = 'retryable';
  /** A token that is in memory but could not be written to storage yet. */
  private pendingWrite: AuthToken | null = null;

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
   * share one request; each interprets the result for its `reason` (see RefreshReason).
   * 401 always ends the session; 429/503/network never do (backoff honouring Retry-After).
   * @throws SecureStorageUnavailableError when the token can't be read right now (NOT a logout).
   */
  public async refreshSession(reason: RefreshReason = 'proactive'): Promise<RefreshOutcome> {
    await this.flushPendingWrite();
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    const raw = await this.refreshPromise;
    switch (raw.kind) {
      case 'ok':
        return 'refreshed';
      case 'no_token':
        return 'no_token';
      case 'superseded':
      case 'unpersisted':
      case 'retryable':
        return 'transient';
      case 'rejected':
        await this.endSession(raw.generation);
        return 'invalid';
      case 'failed':
        if (reason === 'api401' || (await this.storedTokenExpired())) {
          await this.endSession(raw.generation);
          return 'invalid';
        }
        return 'transient';
    }
  }

  /** @deprecated use refreshSession(); kept for callers that only need a boolean. */
  public async refreshAccessToken(): Promise<boolean> {
    return (await this.refreshSession()) === 'refreshed';
  }

  /** Current session generation (changes on every sign-in / sign-out). */
  public getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  /**
   * End the session identified by `generation`: clear it and fire the auth-failed callbacks.
   * Idempotent: a no-op if that session was already ended or replaced.
   */
  public async endSession(generation: number): Promise<void> {
    if (generation !== this.sessionGeneration) return;
    await this.clearToken(); // bumps the generation synchronously -> concurrent callers skip
    this.triggerAuthFailedCallbacks();
  }

  private async storedTokenExpired(): Promise<boolean> {
    const meta = await secureStorage.getTokenMeta();
    return !!meta && meta.expiresAt <= nowS();
  }

  private async doRefresh(): Promise<RawRefresh> {
    const currentToken = await this.getToken(); // may throw SecureStorageUnavailableError
    if (!currentToken?.access_token) return { kind: 'no_token' };
    const generation = this.sessionGeneration;
    if (Date.now() < this.nextRefreshAllowedAt) return { kind: this.lastRefreshFailure, generation };

    let response: Response;
    try {
      response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile-app' },
        body: JSON.stringify({ token: currentToken.access_token }),
      });
    } catch (error) {
      console.warn('[Auth] Token refresh: network error, keeping the session');
      return this.backOff('retryable', null, generation);
    }

    if (generation !== this.sessionGeneration) return { kind: 'superseded' };

    if (response.status === 401) {
      console.warn('[Auth] Token refresh rejected (401)');
      return { kind: 'rejected', generation };
    }
    if (response.status === 429 || response.status === 503) {
      console.warn('[Auth] Token refresh throttled / unavailable, keeping the session:', response.status);
      return this.backOff('retryable', retryAfterSeconds(response), generation);
    }
    if (!response.ok) {
      // Current prod: 500 for an expired token, 404 for a deleted user, 400 for invalid input.
      console.warn('[Auth] Token refresh failed:', response.status);
      return this.backOff('failed', retryAfterSeconds(response), generation);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!data?.access_token || typeof data.access_token !== 'string') {
      console.warn('[Auth] Token refresh: malformed response');
      return this.backOff('failed', null, generation);
    }
    if (generation !== this.sessionGeneration) return { kind: 'superseded' };

    this.nextRefreshAllowedAt = 0;
    this.consecutiveRefreshFailures = 0;
    const stored = await this.persistToken({
      access_token: data.access_token,
      token_type: 'bearer',
      expires_in: data.expires_in,
      expires_at: data.expires_at,
      user: data.user,
    });
    if (!stored) {
      console.warn('[Auth] Refreshed token kept in memory; storage write will be retried');
      return { kind: 'unpersisted' };
    }
    console.log('[Auth] Token refresh successful');
    return { kind: 'ok' };
  }

  private backOff(kind: 'retryable' | 'failed', retryAfterS: number | null, generation: number): RawRefresh {
    this.consecutiveRefreshFailures += 1;
    this.lastRefreshFailure = kind;
    const exponential = Math.min(DEFAULT_BACKOFF_S * 2 ** (this.consecutiveRefreshFailures - 1), MAX_BACKOFF_S);
    const delayS = retryAfterS != null ? Math.min(retryAfterS, MAX_BACKOFF_S) : exponential;
    this.nextRefreshAllowedAt = Date.now() + delayS * 1000;
    return { kind, generation };
  }

  /** Retry writing a token that only made it to memory. */
  private async flushPendingWrite(): Promise<void> {
    const pending = this.pendingWrite;
    if (!pending) return;
    try {
      await secureStorage.setToken(pending.access_token, tokenMetaFrom(pending));
      if (this.pendingWrite === pending) this.pendingWrite = null;
    } catch {
      console.warn('[Auth] pending token write failed again; will retry');
    }
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
      await this.flushPendingWrite();
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
    if (response.status === 404) throw new LogoutEverywhereUnavailableError();
    if (!response.ok && response.status !== 401) {
      throw new Error(`logout-all failed: ${response.status}`);
    }
    await this.clearToken();
  }

  /**
   * Delete the account and its data: DELETE /api/account. On success the local session is cleared.
   * 'appleReauthRequired': the account signs in with Apple and the backend needs a fresh Apple
   * authorization code (or appleUnavailable on devices that cannot sign in with Apple).
   */
  public async deleteAccount(body: DeleteAccountRequest = {}): Promise<DeleteAccountOutcome> {
    const token = await this.getToken();
    if (!token?.access_token) return { status: 'failed', code: 'NOT_SIGNED_IN' };
    let response: Response;
    try {
      response = await fetch(`${API_CONFIG.BASE_URL}/api/account`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Type': 'mobile-app',
          Authorization: `Bearer ${token.access_token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { status: 'failed', code: 'NETWORK' };
    }
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    if (response.ok) {
      await this.clearToken();
      return { status: 'deleted' };
    }
    if (response.status === 409 && data?.code === 'APPLE_REAUTH_REQUIRED') return { status: 'appleReauthRequired' };
    return { status: 'failed', code: typeof data?.code === 'string' ? data.code : `HTTP_${response.status}` };
  }

  /** Whether the backend that issued the current token supports logging out everywhere. */
  public async canLogoutEverywhere(): Promise<boolean> {
    try {
      if (!(await this.getToken())) return false;
      return !!(await secureStorage.getTokenMeta())?.logoutAllSupported;
    } catch {
      return false;
    }
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

  /** @returns false when the token could only be kept in memory (write retried later). */
  private async persistToken(token: AuthToken): Promise<boolean> {
    this.token = token;
    this.pendingWrite = null;
    if (!token.access_token) {
      console.warn('Warning: Token is missing access_token field');
    }
    try {
      await secureStorage.setToken(token.access_token, tokenMetaFrom(token));
      return true;
    } catch (error) {
      console.error('Error saving token:', error instanceof Error ? error.message : 'error');
      if (this.token === token) this.pendingWrite = token;
      return false;
    }
  }

  public async clearToken(): Promise<void> {
    try {
      this.sessionGeneration += 1;
      this.token = null;
      this.pendingWrite = null;
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
    this.lastRefreshFailure = 'retryable';
    this.pendingWrite = null;
    this.authFailedCallbacks = [];
  }
}

export const authService = AuthService.getInstance(); 