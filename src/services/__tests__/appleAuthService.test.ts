jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../../config/api', () => ({ API_CONFIG: { BASE_URL: 'https://api.test' } }));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-uuid-uuid-uuid'),
  digestStringAsync: jest.fn(async (_alg: string, s: string) => `sha256(${s})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  isAvailableAsync: jest.fn(async () => true),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithApple, isAppleSignInAvailable } from '../appleAuthService';

const signInAsync = AppleAuthentication.signInAsync as jest.Mock;
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as any;
});

describe('appleAuthService', () => {
  it('sends the hashed nonce to Apple and the raw nonce + token to the backend', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'apple.jwt', fullName: { givenName: 'Jo', familyName: 'Doe' } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok', expires_at: 123, expires_in: 60 }) });

    const res = await signInWithApple();

    const rawNonce = 'uuid-uuid-uuid-uuiduuid-uuid-uuid-uuid';
    expect(signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: `sha256(${rawNonce})` });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/auth/mobile/apple');
    expect(JSON.parse(init.body)).toEqual({ identityToken: 'apple.jwt', rawNonce, fullName: { givenName: 'Jo', familyName: 'Doe' } });
    expect(res).toEqual({ success: true, access_token: 'tok', expires_at: 123, expires_in: 60 });
  });

  it('reports a user cancel without an error message', async () => {
    signInAsync.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(signInWithApple()).resolves.toEqual({ success: false, canceled: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the backend error message', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'apple.jwt', fullName: null });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'This Apple ID cannot be linked' }) });
    await expect(signInWithApple()).resolves.toEqual({ success: false, message: 'This Apple ID cannot be linked' });
  });

  it('fails when Apple returns no identity token', async () => {
    signInAsync.mockResolvedValue({ identityToken: null });
    const res = await signInWithApple();
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is available on iOS when the device supports it', async () => {
    await expect(isAppleSignInAvailable()).resolves.toBe(true);
  });
});
