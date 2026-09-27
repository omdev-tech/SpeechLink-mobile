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


/** Thrown when SecureStore could not be read right now (e.g. iOS keychain locked). The token
 * may well still be there: callers must treat this as "unknown", never as "logged out". */
export class SecureStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecureStorageUnavailableError';
  }
}

/**
 * SecureStore warns (and some platforms/versions fail) above 2048 bytes per value.
 * Our NextAuth v5 JWE access token is typically ~700-1000 chars, but it embeds
 * name/email/picture URL, so it is unbounded — chunk anything larger than this.
 * Tokens are base64url (ASCII), so chars == bytes.
 */
const MAX_CHUNK = 1800;
/** Hard cap (14.4 KB) so cleanup can sweep a fixed, bounded set of chunk keys. */
const MAX_CHUNKS = 8;
const SLOTS = ['a', 'b'] as const;
type Slot = (typeof SLOTS)[number];
const RETRY_BACKOFF_MS = [25, 50, 100];

const isWeb = () => Platform.OS === 'web';

/**
 * Chunked layout: `<key>.chunks` = "<count>.<slot>", chunks at `<key>.<slot>.<i>`, slot a|b.
 * A write fills the slot NOT referenced by the current manifest, flips the manifest last,
 * then sweeps the other slot — so readers never mix two tokens, and a crash leaves at most
 * one stale slot, which the next write/clear sweeps deterministically (bounded by MAX_CHUNKS).
 * `<key>.chunks` = "<count>" + `<key>.<i>` is the pre-slot layout, still readable.
 */
type Manifest = { count: number; slot: string | null };
const manifestKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, slot: string | null, i: number) => (slot ? `${key}.${slot}.${i}` : `${key}.${i}`);

// ---------------------------------------------------------------------------------------------
// Per-key serialisation: writes/clears run one at a time; readers wait for in-flight writes.
const locks = new Map<string, Promise<void>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, settled);
  settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return run;
}

const idle = (key: string) => locks.get(key) ?? Promise.resolve();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Error classification (expo-secure-store 15.0.8, android/.../SecureStoreModule.kt#getItemImpl):
//  - KeyPermanentlyInvalidatedException and BadPaddingException (incl. its subclass
//    AEADBadTagException) are already handled natively: the entry is deleted and null returned.
//  - Everything else is rethrown as DecryptException "Could not decrypt the value for key '<k>'
//    under keychain '<kc>'. Caused by: <cause>" — which covers both permanent corruption (JSON
//    parse failure, missing/unknown scheme, UnrecoverableKeyException, InvalidKeyException) and
//    transient Keystore failures ("Keystore operation failed"...). KeyStoreException "An error
//    occurred when accessing the keystore: The entry for the keystore alias ... is not a ..." /
//    "... couldn't be cast to correct class" is a permanent alias-type mismatch.
// We only self-heal (delete) on Android when the cause is one of the permanent ones. iOS keychain
// errors (e.g. errSecInteractionNotAllowed "User interaction is not allowed." while locked) are
// always treated as transient.
const ANDROID_PERMANENT_CAUSES = [
  /Could not parse the encrypted JSON item/,
  /Could not find the encryption scheme/,
  /has an unknown encoding scheme/,
  /UnrecoverableKey/,
  /KeyPermanentlyInvalidated/,
  /AEADBadTag|BadPadding/,
  /InvalidKeyException/,
  /entry for the keystore alias .* (is not a|couldn't be cast)/,
];

export function isUnrecoverableSecureStoreError(error: unknown): boolean {
  if (Platform.OS !== 'android') return false;
  const message = String((error as any)?.message ?? error);
  const isDecryptOrKeystore =
    message.includes('Could not decrypt the value for key') ||
    message.includes('An error occurred when accessing the keystore');
  return isDecryptOrKeystore && ANDROID_PERMANENT_CAUSES.some((re) => re.test(message));
}

// ---------------------------------------------------------------------------------------------
// Raw layout operations (callers hold the key's lock for writes/deletes).

async function readManifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  if (!raw) return null;
  const [count, slot] = raw.split('.');
  const n = Number(count);
  return n > 0 ? { count: n, slot: slot || null } : null;
}

/** Unreadable manifest == absent here: it is overwritten or deleted by the caller anyway. */
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
    return (await readManifest(key)) ? undefined : null;
  }
  const parts: string[] = [];
  for (let i = 0; i < manifest.count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, manifest.slot, i));
    if (part == null) return undefined;
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

async function sweepSlot(key: string, slot: Slot): Promise<void> {
  for (let i = 0; i < MAX_CHUNKS; i++) await deleteQuietly(chunkKey(key, slot, i));
}

async function sweepLegacyChunks(key: string, manifest: Manifest | null): Promise<void> {
  if (!manifest || (manifest.slot && (SLOTS as readonly string[]).includes(manifest.slot))) return;
  for (let i = 0; i < manifest.count; i++) await deleteQuietly(chunkKey(key, manifest.slot, i));
}

async function resetKey(key: string): Promise<void> {
  const manifest = await readManifestSafe(key);
  await deleteQuietly(manifestKey(key));
  await deleteQuietly(key);
  for (const slot of SLOTS) await sweepSlot(key, slot);
  await sweepLegacyChunks(key, manifest);
}

type ReadStatus = 'ok' | 'reset' | 'unavailable';
type ReadResult = { value: string | null; status: ReadStatus };

async function readRaw(key: string): Promise<ReadResult> {
  if (isWeb()) return { value: await AsyncStorage.getItem(key), status: 'ok' };
  await idle(key); // don't read while this key is being rewritten
  try {
    for (let attempt = 0; ; attempt++) {
      const value = await readOnce(key);
      if (value !== undefined) return { value, status: 'ok' };
      if (attempt >= RETRY_BACKOFF_MS.length) return { value: null, status: 'unavailable' };
      await sleep(RETRY_BACKOFF_MS[attempt]); // safety net; the lock should make this rare
    }
  } catch (error: any) {
    if (isUnrecoverableSecureStoreError(error)) {
      // Keystore key lost (OS update, backup restore...): the value can never be decrypted.
      // Expo's recommended recovery is to delete it, or every launch fails forever.
      console.warn('[secureStorage] undecryptable entry, resetting it', error?.message);
      await withLock(key, () => resetKey(key));
      return { value: null, status: 'reset' };
    }
    console.warn('[secureStorage] read failed (transient), keeping the entry', error?.message);
    return { value: null, status: 'unavailable' };
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (isWeb()) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  const count = Math.ceil(value.length / MAX_CHUNK);
  if (count > MAX_CHUNKS) throw new Error(`[secureStorage] value too large (${value.length} chars)`);
  const previous = await readManifestSafe(key);

  if (count <= 1) {
    await SecureStore.setItemAsync(key, value);
    await SecureStore.deleteItemAsync(manifestKey(key));
    for (const slot of SLOTS) await sweepSlot(key, slot);
  } else {
    const slot: Slot = previous?.slot === 'a' ? 'b' : 'a';
    const other: Slot = slot === 'a' ? 'b' : 'a';
    await sweepSlot(key, slot); // leftovers of an interrupted earlier write
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(chunkKey(key, slot, i), value.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK));
    }
    await SecureStore.setItemAsync(manifestKey(key), `${count}.${slot}`); // commit point
    await SecureStore.deleteItemAsync(key);
    await sweepSlot(key, other);
  }
  await sweepLegacyChunks(key, previous);
}

// ---------------------------------------------------------------------------------------------
// Migration from plaintext AsyncStorage (pre-SecureStore app versions).

let migration: Promise<void> | null = null;
let migrationFailed = false;

async function runMigration(): Promise<void> {
  if (isWeb()) return;
  const legacy = await AsyncStorage.multiGet(TOKEN_KEYS);
  for (const [key, value] of legacy) {
    if (!value) continue;
    const current = await readRaw(key);
    // Can't tell whether SecureStore already holds a newer token: try again later.
    if (current.status === 'unavailable') throw new SecureStorageUnavailableError('SecureStore unavailable');
    // A token already in SecureStore is newer than any plaintext leftover.
    if (!current.value) await withLock(key, () => writeRaw(key, value));
  }
  // Only reached once every legacy value is safely in SecureStore.
  await AsyncStorage.multiRemove(LEGACY_SECRET_KEYS);
}

/**
 * Move plaintext AsyncStorage tokens into SecureStore and delete the plaintext copies.
 * Idempotent and memoised; every getter awaits it. On failure the plaintext copy is kept
 * (user stays logged in) and the migration is retried on the next call.
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

// ---------------------------------------------------------------------------------------------
// Public API

/**
 * @returns the stored value, or null when there is none (logged out).
 * @throws SecureStorageUnavailableError when SecureStore can't be read right now — NOT a logout.
 */
async function read(key: string): Promise<string | null> {
  await migrateLegacyTokens();
  const { value, status } = await readRaw(key);
  if (value != null) return value;
  if (status !== 'ok' || migrationFailed) {
    // Keep the session working from a plaintext legacy copy if one is still there
    // (and retry migrating it next time).
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) {
      migration = null;
      return legacy;
    }
  }
  if (status === 'unavailable') {
    throw new SecureStorageUnavailableError(`SecureStore temporarily unreadable for ${key}`);
  }
  return null;
}

async function write(key: string, value: string): Promise<void> {
  await migrateLegacyTokens();
  await withLock(key, () => writeRaw(key, value));
  if (!isWeb()) await AsyncStorage.removeItem(key); // never leave a plaintext twin behind
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
    await withLock(key, () => (isWeb() ? AsyncStorage.removeItem(key) : resetKey(key)));
  }
  await AsyncStorage.multiRemove(LEGACY_SECRET_KEYS);
}

/** Test-only: forget that the migration already ran. */
export function __resetMigrationForTests(): void {
  migration = null;
  migrationFailed = false;
}
