/**
 * The ONE place auth secrets are persisted.
 *
 * Tokens live in expo-secure-store (iOS Keychain / Android Keystore-backed
 * EncryptedSharedPreferences). Non-secret preferences (theme, language, audio
 * device...) stay in AsyncStorage — do not put them here.
 *
 * Before this module existed, tokens were written in plaintext to AsyncStorage
 * under the same keys. The first read after an app update migrates them
 * (see migrateLegacyTokens) so upgrading users are not logged out.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const ACCESS_TOKEN_KEY = 'auth_token';
export const REFRESH_TOKEN_KEY = 'refresh_token';

const TOKEN_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY];
// Plaintext AsyncStorage keys that ever held secrets (code_verifier: old PKCE LoginScreen).
const LEGACY_SECRET_KEYS = [...TOKEN_KEYS, 'code_verifier'];

/**
 * SecureStore warns (and some platforms/versions fail) above 2048 bytes per value.
 * Our NextAuth v5 JWE access token is typically ~700-1000 chars, but it embeds
 * name/email/picture URL, so it is unbounded — chunk anything larger than this.
 * Tokens are base64url (ASCII), so chars == bytes.
 */
const MAX_CHUNK = 1800;
const chunkCountKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

// SecureStore has no web implementation; the web build keeps using AsyncStorage.
const isWeb = Platform.OS === 'web';

async function readRaw(key: string): Promise<string | null> {
  if (isWeb) return AsyncStorage.getItem(key);
  const count = Number(await SecureStore.getItemAsync(chunkCountKey(key)));
  if (!count) return SecureStore.getItemAsync(key);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part == null) return null; // torn write — treat as absent
    parts.push(part);
  }
  return parts.join('');
}

async function deleteRaw(key: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.removeItem(key);
    return;
  }
  const count = Number(await SecureStore.getItemAsync(chunkCountKey(key)));
  for (let i = 0; i < (count || 0); i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(chunkCountKey(key));
  await SecureStore.deleteItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await deleteRaw(key);
  if (value.length <= MAX_CHUNK) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const count = Math.ceil(value.length / MAX_CHUNK);
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK));
  }
  // Written last so a reader never sees a count whose chunks are not all there yet.
  await SecureStore.setItemAsync(chunkCountKey(key), String(count));
}

let migration: Promise<void> | null = null;
let migrationFailed = false;

async function runMigration(): Promise<void> {
  if (isWeb) return;
  const legacy = await AsyncStorage.multiGet(TOKEN_KEYS);
  for (const [key, value] of legacy) {
    // A token already in SecureStore is newer than any plaintext leftover.
    if (value && !(await readRaw(key))) {
      await writeRaw(key, value);
    }
  }
  // Only reached once every legacy value is safely in SecureStore.
  await AsyncStorage.multiRemove(LEGACY_SECRET_KEYS);
}

/**
 * Move plaintext AsyncStorage tokens (pre-SecureStore app versions) into SecureStore and
 * delete the plaintext copies. Idempotent and memoised; every getter awaits it.
 * If SecureStore is unavailable the plaintext copy is kept (user stays logged in) and the
 * migration is retried on the next call.
 */
export function migrateLegacyTokens(): Promise<void> {
  if (!migration) {
    migration = runMigration()
      .then(() => {
        migrationFailed = false;
      })
      .catch((error) => {
        migrationFailed = true;
        migration = null;
        console.warn('[secureStorage] token migration failed; will retry', error?.message);
      });
  }
  return migration;
}

async function read(key: string): Promise<string | null> {
  await migrateLegacyTokens();
  const value = await readRaw(key);
  if (value == null && migrationFailed) {
    // Migration could not complete: keep the session working from the legacy copy.
    return AsyncStorage.getItem(key);
  }
  return value;
}

async function write(key: string, value: string): Promise<void> {
  await migrateLegacyTokens();
  await writeRaw(key, value);
  if (!isWeb) await AsyncStorage.removeItem(key); // never leave a plaintext twin behind
}

export const getToken = () => read(ACCESS_TOKEN_KEY);
export const setToken = (token: string) => write(ACCESS_TOKEN_KEY, token);
export const getRefreshToken = () => read(REFRESH_TOKEN_KEY);
export const setRefreshToken = (token: string) => write(REFRESH_TOKEN_KEY, token);

/** Logout / reset: remove every auth secret from SecureStore (and any plaintext leftovers). */
export async function clearTokens(): Promise<void> {
  for (const key of TOKEN_KEYS) {
    await deleteRaw(key);
  }
  await AsyncStorage.multiRemove(LEGACY_SECRET_KEYS);
}

/** Test-only: forget that the migration already ran. */
export function __resetMigrationForTests(): void {
  migration = null;
  migrationFailed = false;
}
