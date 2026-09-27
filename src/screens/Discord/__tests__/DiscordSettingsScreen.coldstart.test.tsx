import { mockDiscord, mockDiscordConfig, resetDiscordMock } from '../../../test-utils/discordScreenMocks';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import DiscordSettingsScreen from '../DiscordSettingsScreen';

const COLD_START_URL = 'com.naqued.speechlinkmobile://discord-callback?status=success&tempKey=K';
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('DiscordSettingsScreen - cold-start discord-callback link', () => {
  let alertSpy: jest.SpyInstance;
  let addListener: jest.SpyInstance;

  beforeEach(() => {
    resetDiscordMock({ isAuthenticated: false });
    // Like the real (unmemoized) provider: new function identities on every render.
    mockDiscordConfig.freshIdentities = true;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // getInitialURL keeps returning the launch URL for the whole process life.
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(COLD_START_URL);
    addListener = jest.spyOn(Linking, 'addEventListener');
  });

  afterEach(() => {
    mockDiscordConfig.freshIdentities = false;
    jest.restoreAllMocks();
  });

  it('is handled exactly once across re-renders and re-mounts, with a single Linking subscription', async () => {
    const screen = render(<DiscordSettingsScreen />);
    await waitFor(() => expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1));
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledWith('', expect.objectContaining({ tempKey: 'K' }));

    for (let i = 0; i < 5; i++) {
      screen.rerender(<DiscordSettingsScreen />);
      await flush();
    }
    expect(addListener).toHaveBeenCalledTimes(1);

    // Navigating away and back must not replay the launch URL either.
    screen.unmount();
    render(<DiscordSettingsScreen />);
    await flush();
    await flush();

    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls.map((c) => c[0])).toEqual(['discord.authSuccess']);
  });
});
