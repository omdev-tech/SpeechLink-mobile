/* global jest */
// Global mocks for native modules that have no JS implementation under Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
