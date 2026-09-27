/* global jest */
// Global mocks for native modules that have no JS implementation under Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-secure-store is a native module (Keychain / Android Keystore). Replace it with an
// in-memory store so tests can assert what was written. `__store` exposes the backing Map.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      if (typeof value !== 'string') throw new Error('SecureStore only stores strings');
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});
