jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    const q = url.split('?')[1] || '';
    return { queryParams: Object.fromEntries(new URLSearchParams(q)) };
  },
}));

import * as WebBrowser from 'expo-web-browser';
import googleAuthService from '../googleAuthService';

const TEMP_KEY = 'SECRET-TEMPKEY-abc123';
const ACCESS = 'SECRET-ACCESS-eyJhbGciOi';
const BEARER = 'SECRET-EXISTING-BEARER';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=SECRET-STATE&code_challenge=x';

const consoleMethods = ['log', 'info', 'debug', 'warn', 'error'] as const;
let spies: jest.SpyInstance[];
const allLogged = () => JSON.stringify(spies.flatMap((s) => s.mock.calls));

function mockFetch(verifyOk: boolean) {
  (global as any).fetch = jest.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (body.operation === 'get-auth-url') {
      return { ok: true, json: async () => ({ authUrl: AUTH_URL }) };
    }
    return verifyOk
      ? { ok: true, json: async () => ({ success: true, access_token: ACCESS, user: { id: 'u1', email: 'e@x.y' } }) }
      : { ok: false, json: async () => ({ success: false, error: 'bad key', tempKey: TEMP_KEY }) };
  });
}

beforeEach(() => {
  spies = consoleMethods.map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
    type: 'success',
    url: `com.naqued.speechlinkmobile://auth/google/callback?tempKey=${TEMP_KEY}`,
  });
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

describe('googleAuthService logging', () => {
  it('successful flow returns the token but never logs tempKey, auth URL state, bearer or token', async () => {
    mockFetch(true);
    const res = await googleAuthService.startGoogleAuth(BEARER);
    expect(res.success).toBe(true);
    expect(res.access_token).toBe(ACCESS);
    expect(allLogged()).not.toContain('SECRET-');
  });

  it('failed verification does not log the tempKey either', async () => {
    mockFetch(false);
    const res = await googleAuthService.startGoogleAuth(BEARER);
    expect(res.success).toBe(false);
    expect(allLogged()).not.toContain('SECRET-');
  });
});
