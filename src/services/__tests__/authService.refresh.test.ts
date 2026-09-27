jest.mock('../../api/auth', () => ({
  login: jest.fn(),
  register: jest.fn(),
  refreshTokens: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  logout: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as secureStorage from '../secureStorage';
import { authService, LogoutEverywhereUnavailableError } from '../authService';
import { login } from '../../api/auth';

const secure = (SecureStore as any).__store as Map<string, string>;
const DAY = 24 * 60 * 60;
const NOW_S = 1_800_000_000; // fixed "now" (unix seconds)

type MockResponse = { status: number; body?: any; headers?: Record<string, string> };
const respond = ({ status, body = {}, headers = {} }: MockResponse) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

let fetchMock: jest.Mock;
let nowMs: number;
let failed: jest.Mock;

const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/mobile/refresh'));

async function seedSession(token: string, meta: secureStorage.TokenMeta | null) {
  await secureStorage.setToken(token, meta ?? undefined);
  if (!meta) await secureStorage.setTokenMeta(null);
  authService.__resetSessionStateForTests(); // cold start: nothing cached in memory
  authService.onAuthenticationFailed(failed);
}

beforeEach(async () => {
  secure.clear();
  await AsyncStorage.clear();
  secureStorage.__resetMigrationForTests();
  authService.__resetSessionStateForTests();
  nowMs = NOW_S * 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  failed = jest.fn();
  authService.onAuthenticationFailed(failed);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  authService.__resetSessionStateForTests();
  jest.restoreAllMocks();
});

describe('proactive refresh decision (launch / foreground)', () => {
  it('refreshes when the token expires in less than 30 days and stores the new token + expires_at', async () => {
    await seedSession('old-tok', { expiresAt: NOW_S + 10 * DAY, obtainedAt: NOW_S - 80 * DAY, estimated: false });
    fetchMock.mockResolvedValueOnce(
      respond({
        status: 200,
        body: { access_token: 'new-tok', token_type: 'Bearer', expires_in: 7776000, expires_at: NOW_S + 90 * DAY, user: { id: 'u1' } },
      })
    );

    await expect(authService.refreshIfNeeded()).resolves.toBe('refreshed');

    expect(refreshCalls()).toHaveLength(1);
    const [, init] = refreshCalls()[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'old-tok' });
    expect(await secureStorage.getToken()).toBe('new-tok');
    expect(await secureStorage.getTokenMeta()).toEqual({ expiresAt: NOW_S + 90 * DAY, obtainedAt: NOW_S, estimated: false, logoutAllSupported: true });
    expect((await authService.getToken())?.access_token).toBe('new-tok');
  });

  it('does not refresh when the token has more than 30 days left', async () => {
    await seedSession('tok', { expiresAt: NOW_S + 60 * DAY, obtainedAt: NOW_S - 30 * DAY, estimated: false });
    await expect(authService.refreshIfNeeded()).resolves.toBe('not_needed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when logged out', async () => {
    await expect(authService.refreshIfNeeded()).resolves.toBe('no_token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a legacy token (no expires_at) exactly once, even against the current backend (no expires_at in response)', async () => {
    await seedSession('legacy-tok', null);
    fetchMock.mockResolvedValue(respond({ status: 200, body: { access_token: 'fresh-tok', user: { id: 'u1' } } }));

    await expect(authService.refreshIfNeeded()).resolves.toBe('refreshed');
    expect(await secureStorage.getToken()).toBe('fresh-tok');
    // Unknown expiry: conservative local estimate of now + 25 days.
    expect(await secureStorage.getTokenMeta()).toEqual({ expiresAt: NOW_S + 25 * DAY, obtainedAt: NOW_S, estimated: true, logoutAllSupported: false });

    // Next launch a few hours later: no refresh storm.
    authService.__resetSessionStateForTests();
    nowMs += 3 * 60 * 60 * 1000;
    await expect(authService.refreshIfNeeded()).resolves.toBe('not_needed');
    expect(refreshCalls()).toHaveLength(1);
  });

  it('re-refreshes an estimated-expiry token after a day so current-backend 30-day sessions stay alive', async () => {
    await seedSession('tok', { expiresAt: NOW_S + 23 * DAY, obtainedAt: NOW_S - 2 * DAY, estimated: true });
    fetchMock.mockResolvedValue(respond({ status: 200, body: { access_token: 'tok-2' } }));
    await expect(authService.refreshIfNeeded()).resolves.toBe('refreshed');
    expect(refreshCalls()).toHaveLength(1);
  });

  it('concurrent proactive checks share a single refresh', async () => {
    await seedSession('tok', null);
    let resolve!: (r: any) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const all = Promise.all([authService.refreshIfNeeded(), authService.refreshIfNeeded(), authService.refreshIfNeeded()]);
    await new Promise((r) => setImmediate(r));
    resolve(respond({ status: 200, body: { access_token: 'tok-2', expires_at: NOW_S + 90 * DAY } }));
    expect(await all).toEqual(['refreshed', 'refreshed', 'refreshed']);
    expect(refreshCalls()).toHaveLength(1);
  });
});

describe('refreshSession outcomes', () => {
  const soonMeta = () => ({ expiresAt: NOW_S + 5 * DAY, obtainedAt: NOW_S - 85 * DAY, estimated: false, logoutAllSupported: false });

  it('401 from refresh = session dead: clears token + expiry and signals logout', async () => {
    await seedSession('dead-tok', soonMeta());
    fetchMock.mockResolvedValueOnce(respond({ status: 401, body: { error: 'Invalid or expired token' } }));

    await expect(authService.refreshSession()).resolves.toBe('invalid');
    expect(await secureStorage.getToken()).toBeNull();
    expect(await secureStorage.getTokenMeta()).toBeNull();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, { 'retry-after': '60' }],
    [503, { 'retry-after': '30' }],
    [500, {}],
    [502, {}],
  ])('%i keeps the token (transient, not a sign-out)', async (status, headers) => {
    await seedSession('tok', soonMeta());
    fetchMock.mockResolvedValueOnce(respond({ status, headers, body: { error: 'x' } }));

    await expect(authService.refreshSession()).resolves.toBe('transient');
    expect(await secureStorage.getToken()).toBe('tok');
    expect(await secureStorage.getTokenMeta()).toEqual(soonMeta());
    expect(failed).not.toHaveBeenCalled();
  });

  it('a network error keeps the token', async () => {
    await seedSession('tok', soonMeta());
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(authService.refreshSession()).resolves.toBe('transient');
    expect(await secureStorage.getToken()).toBe('tok');
    expect(failed).not.toHaveBeenCalled();
  });

  it('respects Retry-After: no new refresh request until it has elapsed', async () => {
    await seedSession('tok', soonMeta());
    fetchMock.mockResolvedValueOnce(respond({ status: 429, headers: { 'retry-after': '60' } }));
    await authService.refreshSession();

    nowMs += 30_000;
    await expect(authService.refreshSession()).resolves.toBe('transient');
    expect(refreshCalls()).toHaveLength(1);

    nowMs += 31_000;
    fetchMock.mockResolvedValueOnce(respond({ status: 200, body: { access_token: 'tok-2', expires_at: NOW_S + 90 * DAY } }));
    await expect(authService.refreshSession()).resolves.toBe('refreshed');
    expect(refreshCalls()).toHaveLength(2);
  });

  it('single-flight: concurrent callers share one refresh request', async () => {
    await seedSession('tok', soonMeta());
    let resolve!: (r: any) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const calls = [authService.refreshSession(), authService.refreshSession(), authService.refreshSession()];
    await new Promise((r) => setImmediate(r));
    resolve(respond({ status: 200, body: { access_token: 'tok-2', expires_at: NOW_S + 90 * DAY } }));
    expect(await Promise.all(calls)).toEqual(['refreshed', 'refreshed', 'refreshed']);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('a logout while a refresh is in flight is not undone by the refresh response', async () => {
    await seedSession('tok', soonMeta());
    let resolve!: (r: any) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const pending = authService.refreshSession();
    await new Promise((r) => setImmediate(r));
    await authService.clearToken();
    resolve(respond({ status: 200, body: { access_token: 'tok-2', expires_at: NOW_S + 90 * DAY } }));
    await pending;
    expect(await secureStorage.getToken()).toBeNull();
    expect(await authService.getToken()).toBeNull();
  });
});

describe('proactive refresh of an already-expired token (e.g. current prod: 500 on expired)', () => {
  const expiredMeta = (estimated: boolean) => ({ expiresAt: NOW_S - 60, obtainedAt: NOW_S - 26 * DAY, estimated });

  it.each([
    [500, true],
    [500, false],
    [404, true],
    [400, false],
  ])('%i with an expired token (estimated=%s) ends the session once', async (status, estimated) => {
    await seedSession('expired-tok', expiredMeta(estimated));
    fetchMock.mockResolvedValue(respond({ status, body: { error: 'x' } }));

    await expect(authService.refreshIfNeeded()).resolves.toBe('invalid');
    expect(await secureStorage.getToken()).toBeNull();
    expect(await secureStorage.getTokenMeta()).toBeNull();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('%i with an expired token is still transient (token kept)', async (status) => {
    await seedSession('expired-tok', expiredMeta(true));
    fetchMock.mockResolvedValue(respond({ status, headers: { 'retry-after': '30' } }));
    await expect(authService.refreshIfNeeded()).resolves.toBe('transient');
    expect(await secureStorage.getToken()).toBe('expired-tok');
    expect(failed).not.toHaveBeenCalled();
  });

  it('a network error with an expired token keeps it (offline is not a sign-out)', async () => {
    await seedSession('expired-tok', expiredMeta(true));
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(authService.refreshIfNeeded()).resolves.toBe('transient');
    expect(await secureStorage.getToken()).toBe('expired-tok');
  });
});

describe('refreshSession after the API rejected the token (reason "api401")', () => {
  const meta = { expiresAt: NOW_S + 20 * DAY, obtainedAt: NOW_S - 5 * DAY, estimated: true };

  it.each([400, 404, 500, 502])('%i from refresh is final: session ended once', async (status) => {
    await seedSession('tok', meta);
    fetchMock.mockResolvedValue(respond({ status }));
    await expect(authService.refreshSession('api401')).resolves.toBe('invalid');
    expect(await secureStorage.getToken()).toBeNull();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('%i from refresh is transient', async (status) => {
    await seedSession('tok', meta);
    fetchMock.mockResolvedValue(respond({ status, headers: { 'retry-after': '60' } }));
    await expect(authService.refreshSession('api401')).resolves.toBe('transient');
    expect(await secureStorage.getToken()).toBe('tok');
    expect(failed).not.toHaveBeenCalled();
  });

  it('a proactive 500 that is backing off does not hide a dead session from the 401 path', async () => {
    await seedSession('tok', meta);
    fetchMock.mockResolvedValue(respond({ status: 500 }));
    await expect(authService.refreshSession()).resolves.toBe('transient');
    await expect(authService.refreshSession('api401')).resolves.toBe('invalid');
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

describe('refreshed token that could not be persisted', () => {
  it('is kept in memory, not reported as refreshed, and written on the next call', async () => {
    await seedSession('old-tok', { expiresAt: NOW_S + 5 * DAY, obtainedAt: NOW_S - 85 * DAY, estimated: false });
    fetchMock.mockResolvedValueOnce(respond({ status: 200, body: { access_token: 'new-tok', expires_at: NOW_S + 90 * DAY } }));
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Keystore operation failed'));

    await expect(authService.refreshSession()).resolves.toBe('transient');
    expect((await authService.getToken())?.access_token).toBe('new-tok'); // in-memory
    expect(await secureStorage.getToken()).toBe('old-tok'); // not persisted yet

    // Next foreground / call: the pending write is retried, no new refresh request.
    await expect(authService.refreshIfNeeded()).resolves.toBe('not_needed');
    expect(await secureStorage.getToken()).toBe('new-tok');
    expect((await secureStorage.getTokenMeta())?.expiresAt).toBe(NOW_S + 90 * DAY);
    expect(refreshCalls()).toHaveLength(1);
  });
});

describe('log-out-everywhere capability', () => {
  it('is supported when the server sent expires_at (new backend)', async () => {
    await authService.saveToken({ access_token: 't', expires_at: NOW_S + 90 * DAY });
    await expect(authService.canLogoutEverywhere()).resolves.toBe(true);
  });

  it('is not supported with the current backend (no expires_at), nor after a current-backend refresh', async () => {
    await authService.saveToken({ access_token: 't' });
    await expect(authService.canLogoutEverywhere()).resolves.toBe(false);

    await authService.saveToken({ access_token: 't', expires_at: NOW_S + 10 * DAY });
    authService.__resetSessionStateForTests();
    fetchMock.mockResolvedValueOnce(respond({ status: 200, body: { access_token: 't2' } }));
    await authService.refreshSession();
    await expect(authService.canLogoutEverywhere()).resolves.toBe(false);
  });

  it('is not supported when signed out', async () => {
    await expect(authService.canLogoutEverywhere()).resolves.toBe(false);
  });
});

describe('expiry bookkeeping on login / logout', () => {
  it('login stores expires_at from the response', async () => {
    (login as jest.Mock).mockResolvedValueOnce({
      access_token: 'login-tok',
      accessToken: 'login-tok',
      token_type: 'Bearer',
      expires_in: 7776000,
      expires_at: NOW_S + 90 * DAY,
      user: { id: 'u1', email: 'a@b.c' },
    });
    await authService.loginWithCredentials({ email: 'a@b.c', password: 'pw' });
    expect(await secureStorage.getToken()).toBe('login-tok');
    expect(await secureStorage.getTokenMeta()).toEqual({ expiresAt: NOW_S + 90 * DAY, obtainedAt: NOW_S, estimated: false, logoutAllSupported: true });
  });

  it('a token saved with only expires_in gets expires_at = now + expires_in', async () => {
    await authService.saveToken({ access_token: 't', expires_in: 7776000 });
    expect(await secureStorage.getTokenMeta()).toEqual({ expiresAt: NOW_S + 7776000, obtainedAt: NOW_S, estimated: false, logoutAllSupported: false });
  });

  it('a token saved without any expiry (current backend) gets a conservative 25-day estimate', async () => {
    await authService.saveToken({ access_token: 't' });
    expect(await secureStorage.getTokenMeta()).toEqual({ expiresAt: NOW_S + 25 * DAY, obtainedAt: NOW_S, estimated: true, logoutAllSupported: false });
  });

  it('clearToken removes the expiry too', async () => {
    await authService.saveToken({ access_token: 't', expires_at: NOW_S + 90 * DAY });
    await authService.clearToken();
    expect(await secureStorage.getTokenMeta()).toBeNull();
  });
});

describe('logoutEverywhere', () => {
  it('POSTs /api/auth/logout-all with the bearer token, then clears the session locally', async () => {
    await seedSession('tok', { expiresAt: NOW_S + 60 * DAY, obtainedAt: NOW_S, estimated: false });
    fetchMock.mockResolvedValueOnce(respond({ status: 200, body: { success: true } }));

    await authService.logoutEverywhere();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/logout-all$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(await secureStorage.getToken()).toBeNull();
    expect(await secureStorage.getTokenMeta()).toBeNull();
  });

  it('a 401 means the session is already gone: clears locally as well', async () => {
    await seedSession('tok', null);
    fetchMock.mockResolvedValueOnce(respond({ status: 401 }));
    await authService.logoutEverywhere();
    expect(await secureStorage.getToken()).toBeNull();
  });

  it('404 (backend without logout-all) rejects with LogoutEverywhereUnavailableError', async () => {
    await seedSession('tok', null);
    fetchMock.mockResolvedValueOnce(respond({ status: 404 }));
    await expect(authService.logoutEverywhere()).rejects.toBeInstanceOf(LogoutEverywhereUnavailableError);
    expect(await secureStorage.getToken()).toBe('tok');
  });

  it.each([404, 500, 503])('fails loudly on %i and keeps the session (other devices were NOT signed out)', async (status) => {
    await seedSession('tok', null);
    fetchMock.mockResolvedValueOnce(respond({ status }));
    await expect(authService.logoutEverywhere()).rejects.toThrow();
    expect(await secureStorage.getToken()).toBe('tok');
  });
});
