import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as secureStorage from '../secureStorage';
import { authService } from '../authService';
import { apiService } from '../apiService';

const secure = (SecureStore as any).__store as Map<string, string>;
const NOW_S = 1_800_000_000;
const DAY = 86400;

const respond = (status: number, body: any = {}, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

let fetchMock: jest.Mock;
let failed: jest.Mock;
const isRefresh = (url: string) => url.endsWith('/api/auth/mobile/refresh');
const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => isRefresh(String(url)));
const apiCalls = () => fetchMock.mock.calls.filter(([url]) => !isRefresh(String(url)));
const bearerOf = (call: any[]) => call[1].headers.Authorization;

/** Routes: the API answers per `apiStatus(bearer)`, the refresh endpoint per `refresh()`. */
function route(apiStatus: (bearer: string) => number, refresh: () => any) {
  fetchMock.mockImplementation(async (url: string, init: any) => {
    if (isRefresh(String(url))) return refresh();
    const status = apiStatus(init.headers.Authorization);
    return respond(status, status === 200 ? { ok: true } : { error: 'Unauthorized' });
  });
}

beforeEach(async () => {
  secure.clear();
  await AsyncStorage.clear();
  secureStorage.__resetMigrationForTests();
  authService.__resetSessionStateForTests();
  jest.spyOn(Date, 'now').mockImplementation(() => NOW_S * 1000);
  await secureStorage.setToken('old-tok', { expiresAt: NOW_S + 60 * DAY, obtainedAt: NOW_S - DAY, estimated: false });
  authService.__resetSessionStateForTests();
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

describe('apiService: 401 on an authenticated route', () => {
  it('refreshes once, retries once with the new token, and succeeds', async () => {
    route(
      (bearer) => (bearer === 'Bearer new-tok' ? 200 : 401),
      () => respond(200, { access_token: 'new-tok', expires_at: NOW_S + 90 * DAY })
    );

    await expect(apiService.get('/api/profile')).resolves.toEqual({ ok: true });
    expect(refreshCalls()).toHaveLength(1);
    expect(apiCalls().map(bearerOf)).toEqual(['Bearer old-tok', 'Bearer new-tok']);
    expect(failed).not.toHaveBeenCalled();
  });

  it('logs out when the refresh also answers 401 (and never loops)', async () => {
    route(() => 401, () => respond(401, { error: 'Invalid or expired token' }));

    await expect(apiService.get('/api/profile')).rejects.toThrow(/log in again/i);
    expect(refreshCalls()).toHaveLength(1);
    expect(apiCalls()).toHaveLength(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(await secureStorage.getToken()).toBeNull();
  });

  it('does not refresh again when the retried request is still 401', async () => {
    route(() => 401, () => respond(200, { access_token: 'new-tok', expires_at: NOW_S + 90 * DAY }));

    await expect(apiService.get('/api/profile')).rejects.toThrow();
    expect(refreshCalls()).toHaveLength(1);
    expect(apiCalls()).toHaveLength(2);
  });

  it.each([503, 429])('keeps the session when the refresh fails transiently (%i)', async (status) => {
    route(() => 401, () => respond(status, {}, { 'retry-after': '30' }));

    await expect(apiService.get('/api/profile')).rejects.toThrow();
    expect(failed).not.toHaveBeenCalled();
    expect(await secureStorage.getToken()).toBe('old-tok');
    expect(apiCalls()).toHaveLength(1);
  });

  it.each([500, 404, 400])('logs out when the API said 401 and the refresh fails with %i (dead token on current prod)', async (status) => {
    route(() => 401, () => respond(status, { error: 'x' }));

    await expect(apiService.get('/api/profile')).rejects.toThrow(/log in again/i);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(await secureStorage.getToken()).toBeNull();
    expect(apiCalls()).toHaveLength(1);
  });

  it('expired token on current prod (refresh 500 "decode failed") -> signed out, not stuck', async () => {
    await secureStorage.setToken('expired-tok', { expiresAt: NOW_S - DAY, obtainedAt: NOW_S - 26 * DAY, estimated: true });
    authService.__resetSessionStateForTests();
    authService.onAuthenticationFailed(failed);
    route(() => 401, () => respond(500, { error: 'Internal Server Error' }));

    await expect(apiService.get('/api/profile')).rejects.toThrow(/log in again/i);
    await expect(apiService.get('/api/other')).rejects.toThrow(); // no token any more: no refresh loop
    expect(refreshCalls()).toHaveLength(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('N in-flight 401s with a dead session -> ONE refresh and ONE sign-out', async () => {
    let resolveRefresh!: (r: any) => void;
    const refreshResponse = new Promise((r) => (resolveRefresh = r));
    route(() => 401, () => refreshResponse);

    const all = Promise.allSettled([1, 2, 3, 4, 5].map((i) => apiService.get(`/api/r${i}`)));
    await new Promise((r) => setTimeout(r, 10));
    resolveRefresh(respond(401, { error: 'Invalid or expired token' }));

    const results = await all;
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(refreshCalls()).toHaveLength(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('retries with the in-memory token when the refreshed token could not be persisted', async () => {
    route(
      (bearer) => (bearer === 'Bearer new-tok' ? 200 : 401),
      () => respond(200, { access_token: 'new-tok', expires_at: NOW_S + 90 * DAY })
    );
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Keystore operation failed'));

    await expect(apiService.get('/api/profile')).resolves.toEqual({ ok: true });
    expect(failed).not.toHaveBeenCalled();
  });

  it('concurrent 401s share ONE refresh, and every request is retried once', async () => {
    let resolveRefresh!: (r: any) => void;
    const refreshResponse = new Promise((r) => (resolveRefresh = r));
    route((bearer) => (bearer === 'Bearer new-tok' ? 200 : 401), () => refreshResponse);

    const all = Promise.all([apiService.get('/api/a'), apiService.get('/api/b'), apiService.post('/api/c', {})]);
    await new Promise((r) => setTimeout(r, 10));
    resolveRefresh(respond(200, { access_token: 'new-tok', expires_at: NOW_S + 90 * DAY }));

    await expect(all).resolves.toHaveLength(3);
    expect(refreshCalls()).toHaveLength(1);
    expect(apiCalls()).toHaveLength(6);
    expect(failed).not.toHaveBeenCalled();
  });

  it('a request that raced a completed refresh just retries with the current token (no second refresh)', async () => {
    // The request went out with old-tok, but a proactive refresh already replaced it.
    route((bearer) => (bearer === 'Bearer new-tok' ? 200 : 401), () => respond(500));
    fetchMock.mockImplementationOnce(async () => {
      await authService.saveToken({ access_token: 'new-tok', expires_at: NOW_S + 90 * DAY });
      return respond(401);
    });

    await expect(apiService.get('/api/profile')).resolves.toEqual({ ok: true });
    expect(refreshCalls()).toHaveLength(0);
  });
});
