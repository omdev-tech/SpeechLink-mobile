import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { __resetMigrationForTests, SecureStorageUnavailableError } from '../secureStorage';

const secure = (SecureStore as any).__store as Map<string, string>;

beforeEach(async () => {
  secure.clear();
  await AsyncStorage.clear();
  __resetMigrationForTests();
});

import { authService as singleton } from '../authService';

/** Simulates a cold start: drop the singleton's in-memory token cache. */
const freshAuthService = () => {
  (singleton as any).token = null;
  return singleton;
};

describe('authService token persistence', () => {
  it('saveToken persists to SecureStore, not plaintext AsyncStorage', async () => {
    const authService = freshAuthService();
    await authService.saveToken({ access_token: 'tok-1', token_type: 'bearer' });
    expect(await AsyncStorage.getItem('auth_token')).toBeNull();
    expect([...secure.values()]).toContain('tok-1');
  });

  it('getToken on a fresh launch migrates a legacy AsyncStorage token (user stays logged in)', async () => {
    await AsyncStorage.setItem('auth_token', 'legacy-tok');
    const authService = freshAuthService();
    const token = await authService.getToken();
    expect(token?.access_token).toBe('legacy-tok');
    expect(await AsyncStorage.getItem('auth_token')).toBeNull();
  });

  it('clearToken (logout) wipes the SecureStore token', async () => {
    const authService = freshAuthService();
    await authService.saveToken({ access_token: 'tok-2' });
    await authService.clearToken();
    expect(secure.size).toBe(0);
    expect(await freshAuthService().getToken()).toBeNull();
  });

  it('a failed (locked keychain) read never clears the session', async () => {
    const authService = freshAuthService();
    await authService.saveToken({ access_token: 'tok-3' });
    (singleton as any).token = null; // cold start
    const getMock = SecureStore.getItemAsync as jest.Mock;
    getMock.mockRejectedValueOnce(new Error('User interaction is not allowed.'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = jest.fn();
    authService.onAuthenticationFailed(failed);

    // "unknown" is surfaced as an error, not as a failed refresh (which would log out)
    await expect(authService.refreshAccessToken()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    expect(failed).not.toHaveBeenCalled();
    expect(secure.get('auth_token')).toBe('tok-3');
    expect((await authService.getToken())?.access_token).toBe('tok-3');
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
