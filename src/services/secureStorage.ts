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
const RETRIES = 3;

// SecureStore has no web implementation; the web build keeps using AsyncStorage.
const isWeb = Platform.OS === 'web';

/**
 * Chunked layout: `<key>.chunks` holds "<count>.<generation>", chunks live at
 * `<key>.<generation>.<i>`. Every write uses a fresh generation, so a reader never mixes
 * chunks from two different tokens, and old chunks are removed only after the new
 * manifest is in place.
 */
type Manifest = { count: number; gen: string | null };
const manifestKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, m: Manifest, i: number) => (m.gen ? `${key}.${m.gen}.${i}` : `${key}.${i}`);
let genCounter = 0;
const newGeneration = () => `${Date.now().toString(36)}${(genCounter++).toString(36)}`;

async function readManifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  if (!raw) return null;
  const [count, gen] = raw.split('.');
  const n = Number(count);
  return n > 0 ? { count: n, gen: gen || null } : null;
}

/** Manifest read that treats an unreadable manifest as absent (it is overwritten/deleted next). */
async function readManifestSafe(key: string): Promise<Manifest | null> {
  try {
    return await readManifest(key);
  } catch {
    return null;
  }
}

/** One read attempt. `undefined` = caught mid-rotation, try again. */
async function readOnce(key: string): Promise<string | null | undefined> {
  const manifest = await readManifest(key);
  if (!manifest) {
    const value = await SecureStore.getItemAsync(key);
    if (value != null) return value;
    // A writer may have switched small -> chunked between our two reads.
    return (await readManifest(key)) ? undefined : null;
  }
  const parts: string[] = [];
  for (let i = 0; i < manifest.count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, manifest, i));
    if (part == null) return undefined; // generation replaced under us
    parts.push(part);
  }
  return parts.join('');
}

async function deleteQuietly(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // best effort
  }
}

async function deleteChunks(key: string, manifest: Manifest | null): Promise<void> {
  if (!manifest) return;
  for (let i = 0; i < manifest.count; i++) {
    await deleteQuietly(chunkKey(key, manifest, i));
  }
}

type ReadResult = { value: string | null; failed: boolean };

async function readRaw(key: string): Promise<ReadResult> {
  if (isWeb) return { value: await AsyncStorage.getItem(key), failed: false };
  try {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const value = await readOnce(key);
      if (value !== undefined) return { value, failed: false };
    }
    return { value: null, failed: false };
  } catch (error: any) {
    // Android: the Keystore key can be lost (OS update, backup restore, lock-screen change)
    // and the value becomes undecryptable. Expo's recommended recovery is to delete it,
    // otherwise every launch fails and new tokens can never be stored.
    console.warn('[secureStorage] unreadable entry, resetting it', error?.message);
    await deleteChunks(key, await readManifestSafe(key));
    await deleteQuietly(manifestKey(key));
    await deleteQuietly(key);
    return { value: null, failed: true };
  }
}

async function deleteRaw(key: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await deleteChunks(key, await readManifestSafe(key));
  await SecureStore.deleteItemAsync(manifestKey(key));
  await SecureStore.deleteItemAsync(key);
}

/**
 * Write the new value first, then remove the old layout, so a concurrent reader always
 * sees either the old or the new token — never "no token" (which would log the user out).
 */
async function writeRaw(key: string, value: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  const previous = await readManifestSafe(key);
  if (value.length <= MAX_CHUNK) {
    await SecureStore.setItemAsync(key, value);
    await SecureStore.deleteItemAsync(manifestKey(key));
  } else {
    const manifest: Manifest = { count: Math.ceil(value.length / MAX_CHUNK), gen: newGeneration() };
    for (let i = 0; i < manifest.count; i++) {
      await SecureStore.setItemAsync(chunkKey(key, manifest, i), value.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK));
    }
    // Manifest last: it only ever points at a complete set of chunks.
    await SecureStore.setItemAsync(manifestKey(key), `${manifest.count}.${manifest.gen}`);
    await SecureStore.deleteItemAsync(key);
  }
  await deleteChunks(key, previous);
}

let migration: Promise<void> | null = null;
let migrationFailed = false;

async function runMigration(): Promise<void> {
  if (isWeb) return;
  const legacy = await AsyncStorage.multiGet(TOKEN_KEYS);
  for (const [key, value] of legacy) {
    // A token already in SecureStore is newer than any plaintext leftover.
    if (value && !(await readRaw(key)).value) {
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
  const { value, failed } = await readRaw(key);
  if (value == null && (migrationFailed || failed)) {
    // Migration incomplete or the SecureStore entry was unreadable: keep the session
    // working from the plaintext legacy copy if one is still there, and retry migrating it.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) migration = null;
    return legacy;
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
  // An in-flight first-launch migration would otherwise re-write the legacy token after we clear.
  await migrateLegacyTokens();
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
