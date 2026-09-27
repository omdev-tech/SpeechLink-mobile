import { mockDiscord, mockDiscordConfig, resetDiscordMock } from '../../../test-utils/discordScreenMocks';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, act } from '@testing-library/react-native';
import DiscordSettingsScreen from '../DiscordSettingsScreen';
import { claimCallbackUrl, resetDiscordCallbackLinksForTests } from '../../../services/discordCallbackLinks';

const COLD_START_URL = 'com.naqued.speechlinkmobile://discord-callback?status=success&tempKey=K';
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('DiscordSettingsScreen - deep-link subscription', () => {
  let alertSpy: jest.SpyInstance;
  let addListener: jest.SpyInstance;

  beforeEach(() => {
    resetDiscordCallbackLinksForTests();
    resetDiscordMock({ isAuthenticated: false });
    // Like an unmemoized provider: new function identities on every render.
    mockDiscordConfig.freshIdentities = true;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(COLD_START_URL);
    addListener = jest.spyOn(Linking, 'addEventListener');
  });

  afterEach(() => {
    mockDiscordConfig.freshIdentities = false;
    jest.restoreAllMocks();
  });

  it('subscribes once across re-renders and leaves the launch URL to DiscordProvider', async () => {
    const screen = render(<DiscordSettingsScreen />);
    for (let i = 0; i < 5; i++) {
      screen.rerender(<DiscordSettingsScreen />);
      await flush();
    }
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(Linking.getInitialURL).not.toHaveBeenCalled();
    expect(mockDiscord.handleDiscordCallback).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not re-handle a link the provider already claimed', async () => {
    let emitUrl: (e: { url: string }) => void = () => {};
    addListener.mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as any);
    claimCallbackUrl(COLD_START_URL); // what DiscordProvider does at cold start
    render(<DiscordSettingsScreen />);
    await flush();
    await act(async () => emitUrl({ url: COLD_START_URL }));
    await flush();
    expect(mockDiscord.handleDiscordCallback).not.toHaveBeenCalled();
  });
});
