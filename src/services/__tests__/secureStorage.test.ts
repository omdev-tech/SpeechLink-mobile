import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  getToken,
  setToken,
  getRefreshToken,
  setRefreshToken,
  clearTokens,
  migrateLegacyTokens,
  __resetMigrationForTests,
  SecureStorageUnavailableError,
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

  describe('SecureStore read errors', () => {
    // Keys in `failing` throw the given native message on read (until deleted, if `sticky`).
    const failing = new Map<string, { message: string; times: number }>();
    const getMock = SecureStore.getItemAsync as jest.Mock;
    const delMock = SecureStore.deleteItemAsync as jest.Mock;
    let origGet: any;
    let origDel: any;
    let warn: jest.SpyInstance;
    let restoreOS: () => void;

    // Exact messages from expo-secure-store 15.0.8 native code.
    const ANDROID_DECRYPT =
      "Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: Could not decrypt the value for key 'auth_token' under keychain 'key_v1'. Caused by: Could not parse the encrypted JSON item in SecureStore: Unterminated object";
    const ANDROID_UNRECOVERABLE =
      "Could not decrypt the value for key 'auth_token' under keychain 'key_v1'. Caused by: android.security.keystore.UnrecoverableKeyException: Failed to obtain information about key";
    const ANDROID_TRANSIENT =
      "Could not decrypt the value for key 'auth_token' under keychain 'key_v1'. Caused by: Keystore operation failed";
    const IOS_LOCKED = "Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: User interaction is not allowed.";

    const setOS = (os: string) => {
      const desc = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
      restoreOS = () => Object.defineProperty(Platform, 'OS', desc);
    };
    const fail = (key: string, message: string, times = Infinity) => failing.set(key, { message, times });

    beforeEach(() => {
      failing.clear();
      restoreOS = () => {};
      origGet = getMock.getMockImplementation();
      origDel = delMock.getMockImplementation();
      getMock.mockImplementation(async (key: string) => {
        const f = failing.get(key);
        if (f && f.times > 0) {
          f.times -= 1;
          throw new Error(f.message);
        }
        return origGet(key);
      });
      delMock.mockImplementation(async (key: string) => {
        failing.delete(key);
        return origDel(key);
      });
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      getMock.mockImplementation(origGet);
      delMock.mockImplementation(origDel);
      warn.mockRestore();
      restoreOS();
    });

    describe('Android: genuinely undecryptable entry (Keystore key lost)', () => {
      beforeEach(() => setOS('android'));

      it('is deleted and the legacy copy is used', async () => {
        secure.set('auth_token', 'garbage');
        fail('auth_token', ANDROID_DECRYPT);
        await AsyncStorage.setItem('auth_token', 'legacy-access');
        await expect(getToken()).resolves.toBe('legacy-access');
      });

      it('with no legacy copy reads as logged-out, and a new login persists', async () => {
        secure.set('auth_token', 'garbage');
        fail('auth_token', ANDROID_UNRECOVERABLE);
        await expect(getToken()).resolves.toBeNull();
        expect(secure.has('auth_token')).toBe(false);
        await setToken('new-login');
        await expect(getToken()).resolves.toBe('new-login');
      });

      it('an unreadable chunk-count key does not block writing a new token', async () => {
        secure.set('auth_token.chunks', '3');
        fail('auth_token.chunks', ANDROID_DECRYPT);
        await setToken('new-login');
        await expect(getToken()).resolves.toBe('new-login');
      });

      it('a transient Keystore failure does NOT delete the token', async () => {
        await setToken('good-token');
        fail('auth_token', ANDROID_TRANSIENT, 1);
        await expect(getToken()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
        expect(secure.get('auth_token')).toBe('good-token');
        await expect(getToken()).resolves.toBe('good-token');
      });
    });

    describe('iOS: keychain locked (errSecInteractionNotAllowed)', () => {
      beforeEach(() => setOS('ios'));

      it('keeps the token; the read reports "unknown" (not logged out) and the next read returns it', async () => {
        await setToken('good-token');
        fail('auth_token', IOS_LOCKED, 1);
        await expect(getToken()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
        expect(secure.get('auth_token')).toBe('good-token');
        await expect(getToken()).resolves.toBe('good-token');
      });

      it('even a "decrypt"-looking message never deletes on iOS', async () => {
        await setToken('good-token');
        fail('auth_token', ANDROID_DECRYPT, 1);
        await expect(getToken()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
        await expect(getToken()).resolves.toBe('good-token');
      });

      it('a locked keychain during migration does not overwrite the SecureStore token with the legacy one', async () => {
        await setToken('fresh');
        await AsyncStorage.setItem('auth_token', 'stale');
        __resetMigrationForTests();
        fail('auth_token', IOS_LOCKED, 1);
        await migrateLegacyTokens();
        expect(secure.get('auth_token')).toBe('fresh');
      });
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

  describe('chunk slots: bounded, no orphans', () => {
    const BIG = (c: string) => c.repeat(4000);
    const chunkKeys = () => [...secure.keys()].filter((k) => /^auth_token\.(a|b|\d)/.test(k));

    it('uses only the two fixed slots a/b', async () => {
      await setToken(BIG('A'));
      await setToken(BIG('B'));
      await setToken(BIG('C'));
      const slots = new Set(chunkKeys().map((k) => k.split('.')[1]));
      expect([...slots].every((s) => s === 'a' || s === 'b')).toBe(true);
      expect(slots.size).toBe(1); // previous slot cleaned after each write
      expect(await getToken()).toBe(BIG('C'));
    });

    it('concurrent setToken(B)/setToken(C) then clearTokens leaves zero chunk keys', async () => {
      await setToken(BIG('A'));
      await Promise.all([setToken(BIG('B')), setToken(BIG('C'))]);
      expect(await getToken()).toBe(BIG('C')); // writes are serialised in call order
      await clearTokens();
      expect([...secure.keys()]).toEqual([]);
    });

    it('a crash mid-write leaves at most one stale slot; the old token stays readable; next clear removes it', async () => {
      await setToken(BIG('A'));
      const setMock = SecureStore.setItemAsync as jest.Mock;
      const orig = setMock.getMockImplementation();
      let calls = 0;
      setMock.mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === 2) throw new Error('process killed');
        return orig!(k, v);
      });
      await expect(setToken(BIG('B'))).rejects.toThrow('process killed');
      setMock.mockImplementation(orig);

      expect(await getToken()).toBe(BIG('A'));
      const slots = new Set(chunkKeys().map((k) => k.split('.')[1]));
      expect(slots.size).toBeLessThanOrEqual(2); // live slot + at most one stale slot
      await clearTokens();
      expect([...secure.keys()]).toEqual([]);
    });

    it('a crash mid-write is cleaned up by the next write', async () => {
      await setToken(BIG('A'));
      const setMock = SecureStore.setItemAsync as jest.Mock;
      const orig = setMock.getMockImplementation();
      let calls = 0;
      setMock.mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === 2) throw new Error('process killed');
        return orig!(k, v);
      });
      await expect(setToken(BIG('B'))).rejects.toThrow();
      setMock.mockImplementation(orig);
      await setToken('small');
      expect([...secure.keys()]).toEqual(['auth_token']);
    });

    it('still reads the legacy plain-count chunk layout', async () => {
      secure.set('auth_token.chunks', '2');
      secure.set('auth_token.0', 'left-');
      secure.set('auth_token.1', 'right');
      expect(await getToken()).toBe('left-right');
      await clearTokens();
      expect([...secure.keys()]).toEqual([]);
    });
  });
});
