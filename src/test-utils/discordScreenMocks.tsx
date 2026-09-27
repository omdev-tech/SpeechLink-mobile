/**
 * Shared mocks for DiscordSettingsScreen tests. Import this module FIRST in a test file:
 * the jest.mock calls below are hoisted within this module, so they are registered before
 * the test file imports the screen.
 */
import { Alert, AlertButton } from 'react-native';

export const mockDiscord = {
  isLoading: false,
  isAuthenticated: false,
  isConnected: false,
  connectionStatus: null as any,
  servers: [] as any[],
  channels: [] as any[],
  currentServer: null as any,
  currentChannel: null as any,
  error: null as string | null,
  getDiscordAuthUrl: jest.fn(),
  handleDiscordCallback: jest.fn(),
  completeDiscordHandoff: jest.fn(),
  loadServers: jest.fn(),
  loadChannels: jest.fn(),
  loadSettings: jest.fn(),
  selectServer: jest.fn(),
  selectChannel: jest.fn(),
  saveSettings: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  refreshConnectionStatus: jest.fn(),
};

/** freshIdentities: return new function identities on every render (unmemoized provider). */
export const mockDiscordConfig = { freshIdentities: false };

jest.mock('../contexts/DiscordContext', () => ({
  useDiscord: () => {
    if (!mockDiscordConfig.freshIdentities) return mockDiscord;
    const fresh: Record<string, unknown> = { ...mockDiscord };
    for (const [key, value] of Object.entries(mockDiscord)) {
      if (typeof value === 'function') fresh[key] = (...args: unknown[]) => (value as any)(...args);
    }
    return fresh;
  },
}));

jest.mock('../contexts/AuthContext', () => {
  const { createContext } = require('react');
  return { AuthContext: createContext({ token: 'test-token' }) };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  dismissBrowser: jest.fn(),
}));

/** Deterministic PKCE pair for screen tests (real generation is covered in discordPkce tests). */
export const TEST_VERIFIER = 'v'.repeat(43);
export const TEST_CHALLENGE = 'c'.repeat(43);
jest.mock('../services/discordPkce', () => ({
  createPkcePair: jest.fn(async () => ({ verifier: 'v'.repeat(43), challenge: 'c'.repeat(43) })),
}));

export const AUTH_URL = 'https://discord.com/api/oauth2/authorize?client_id=x';

/** Resets the context mock to a linked-or-not account with sane async defaults. */
export function resetDiscordMock(overrides: Partial<typeof mockDiscord> = {}) {
  Object.assign(mockDiscord, {
    isLoading: false,
    isAuthenticated: false,
    isConnected: false,
    connectionStatus: null,
    currentServer: null,
    currentChannel: null,
    error: null,
  });
  for (const value of Object.values(mockDiscord)) {
    if (jest.isMockFunction(value)) value.mockReset();
  }
  mockDiscord.getDiscordAuthUrl.mockResolvedValue(AUTH_URL);
  mockDiscord.handleDiscordCallback.mockResolvedValue(true);
  mockDiscord.completeDiscordHandoff.mockResolvedValue({ success: true });
  mockDiscord.loadSettings.mockResolvedValue(undefined);
  mockDiscord.disconnect.mockResolvedValue(true);
  Object.assign(mockDiscord, overrides);
}

/**
 * Spies on Alert.alert and auto-presses the button with the given style (e.g. confirm the
 * "destructive" action of a confirmation dialog). Returns the spy.
 */
export function autoPressAlert(style: AlertButton['style'] = 'destructive') {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const button = buttons?.find((b) => b.style === style);
    button?.onPress?.();
  });
}

