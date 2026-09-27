import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  getToken,
  setToken,
  getRefreshToken,
  setRefreshToken,
  clearTokens,
  migrateLegacyTokens,
  __resetMigrationForTests,
} from '../secureStorage';

const secure = (SecureStore as any).__store as Map<string, string>;
// A realistic NextAuth v5 JWE (A256CBC-HS512) is ~700-1000 chars; build one well past 2048.
const HUGE_TOKEN = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..' + 'x'.repeat(5000);

beforeEach(async () => {
  secure.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  __resetMigrationForTests();
});

describe('secureStorage', () => {
  it('setToken/getToken go through SecureStore, never AsyncStorage', async () => {
    await setToken('access-123');
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('auth_token')).toBeNull();
    expect(await getToken()).toBe('access-123');
  });

  it('stores refresh tokens in SecureStore too', async () => {
    await setRefreshToken('refresh-456');
    expect(await AsyncStorage.getItem('refresh_token')).toBeNull();
    expect(await getRefreshToken()).toBe('refresh-456');
  });

  it('clearTokens wipes access + refresh tokens from SecureStore', async () => {
    await setToken('a');
    await setRefreshToken('r');
    await clearTokens();
    expect(await getToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(secure.size).toBe(0);
  });

  it('keeps every SecureStore value under the 2048-byte limit by chunking large tokens', async () => {
    await setToken(HUGE_TOKEN);
    for (const value of secure.values()) {
      expect(value.length).toBeLessThanOrEqual(2048);
    }
    expect(await getToken()).toBe(HUGE_TOKEN);
  });

  it('replacing a chunked token with a small one leaves no stale chunks behind', async () => {
    await setToken(HUGE_TOKEN);
    await setToken('small');
    expect(await getToken()).toBe('small');
    expect(secure.size).toBe(1);
    await clearTokens();
    expect(secure.size).toBe(0);
  });

  describe('migration from legacy plaintext AsyncStorage', () => {
    it('moves an existing AsyncStorage token into SecureStore and deletes the plaintext copy', async () => {
      await AsyncStorage.setItem('auth_token', 'legacy-access');
      await AsyncStorage.setItem('refresh_token', 'legacy-refresh');
      await AsyncStorage.setItem('code_verifier', 'legacy-verifier');
      await AsyncStorage.setItem('theme', 'dark'); // non-secret pref must survive

      await migrateLegacyTokens();

      expect(await getToken()).toBe('legacy-access');
      expect(await getRefreshToken()).toBe('legacy-refresh');
      expect(await AsyncStorage.getItem('auth_token')).toBeNull();
      expect(await AsyncStorage.getItem('refresh_token')).toBeNull();
      expect(await AsyncStorage.getItem('code_verifier')).toBeNull();
      expect(await AsyncStorage.getItem('theme')).toBe('dark');
    });

    it('runs implicitly on the first getToken() so upgrading users stay logged in', async () => {
      await AsyncStorage.setItem('auth_token', 'legacy-access');
      expect(await getToken()).toBe('legacy-access');
      expect(await AsyncStorage.getItem('auth_token')).toBeNull();
    });

    it('does not overwrite a newer SecureStore token with a stale legacy one', async () => {
      await setToken('fresh');
      await AsyncStorage.setItem('auth_token', 'stale');
      __resetMigrationForTests();
      await migrateLegacyTokens();
      expect(await getToken()).toBe('fresh');
      expect(await AsyncStorage.getItem('auth_token')).toBeNull();
    });

    it('keeps the plaintext copy (no forced logout) if SecureStore write fails, and retries later', async () => {
      await AsyncStorage.setItem('auth_token', 'legacy-access');
      (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore unavailable'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await migrateLegacyTokens();
      expect(await AsyncStorage.getItem('auth_token')).toBe('legacy-access');
      // still usable this session
      expect(await getToken()).toBe('legacy-access');
      warn.mockRestore();
    });
  });

  describe('undecryptable Android keystore entries (OS update / backup restore)', () => {
    // Simulates the Keystore key being gone: reads of these keys throw until they are deleted.
    const corrupt = new Set<string>();
    const getMock = SecureStore.getItemAsync as jest.Mock;
    const delMock = SecureStore.deleteItemAsync as jest.Mock;
    let origGet: any;
    let origDel: any;
    let warn: jest.SpyInstance;

    beforeEach(() => {
      corrupt.clear();
      origGet = getMock.getMockImplementation();
      origDel = delMock.getMockImplementation();
      getMock.mockImplementation(async (key: string) => {
        if (corrupt.has(key)) throw new Error('Could not decrypt the value for key');
        return origGet(key);
      });
      delMock.mockImplementation(async (key: string) => {
        corrupt.delete(key);
        return origDel(key);
      });
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      getMock.mockImplementation(origGet);
      delMock.mockImplementation(origDel);
      warn.mockRestore();
    });

    it('an unreadable entry does not throw: it is deleted and the legacy copy is used', async () => {
      secure.set('auth_token', 'garbage');
      corrupt.add('auth_token');
      await AsyncStorage.setItem('auth_token', 'legacy-access');
      await expect(getToken()).resolves.toBe('legacy-access');
    });

    it('an unreadable entry with no legacy copy reads as logged-out, and a new login persists', async () => {
      secure.set('auth_token', 'garbage');
      corrupt.add('auth_token');
      await expect(getToken()).resolves.toBeNull();
      await setToken('new-login');
      await expect(getToken()).resolves.toBe('new-login');
    });

    it('an unreadable chunk-count key does not block writing a new token', async () => {
      secure.set('auth_token.chunks', '3');
      corrupt.add('auth_token.chunks');
      await setToken('new-login');
      await expect(getToken()).resolves.toBe('new-login');
    });
  });

  it('logout during the first-launch migration does not resurrect the legacy token', async () => {
    await AsyncStorage.setItem('auth_token', 'legacy-access');
    const pendingRead = getToken(); // kicks off the migration
    await clearTokens();
    await pendingRead;
    expect(await getToken()).toBeNull();
    expect(await AsyncStorage.getItem('auth_token')).toBeNull();
  });

  describe('token rotation is never observed as "logged out"', () => {
    const SMALL_A = 'small-A';
    const SMALL_B = 'small-B';
    const BIG_A = 'A'.repeat(4000);
    const BIG_B = 'B'.repeat(2500);
    const cases: Array<[string, string, string]> = [
      ['small -> small', SMALL_A, SMALL_B],
      ['small -> chunked', SMALL_A, BIG_A],
      ['chunked -> chunked', BIG_A, BIG_B],
      ['chunked -> small', BIG_B, SMALL_B],
    ];
    it.each(cases)('%s', async (_name, from, to) => {
      await setToken(from);
      const seen = new Set<string | null>();
      let done = false;
      const write = setToken(to).then(() => {
        done = true;
      });
      while (!done) {
        seen.add(await getToken());
      }
      await write;
      seen.add(await getToken());
      for (const v of seen) expect([from, to]).toContain(v);
      expect(await getToken()).toBe(to);
    });
  });
});
