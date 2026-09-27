import { mockDiscord, resetDiscordMock, autoPressAlert, AUTH_URL } from '../../../test-utils/discordScreenMocks';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import DiscordSettingsScreen from '../DiscordSettingsScreen';

const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

/** URL of whichever in-app browser API the screen used to start Discord OAuth. */
const openedUrls = () => [...openAuthSession.mock.calls, ...openBrowser.mock.calls].map((c) => c[0]);

describe('DiscordSettingsScreen - "Refresh connection" (re-authenticate Discord)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Account linked on the server (row exists), but its tokens were lost server-side.
    resetDiscordMock({ isAuthenticated: true, isConnected: false });
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    openBrowser.mockResolvedValue({ type: 'cancel' });
  });

  it('is offered as soon as the Discord account is linked, even when not in a voice channel', async () => {
    const screen = render(<DiscordSettingsScreen />);
    expect(await screen.findByText('discord.refreshConnection')).toBeTruthy();
  });

  it('is not offered when no Discord account is linked', async () => {
    resetDiscordMock({ isAuthenticated: false });
    const screen = render(<DiscordSettingsScreen />);
    await screen.findByText('discord.linkAccount');
    expect(screen.queryByText('discord.refreshConnection')).toBeNull();
  });

  it('re-runs Discord OAuth although isAuthenticated is true, and only trusts a freshly claimed code', async () => {
    // Visible in both the WIP (isConnected-gated) and the fixed screen.
    mockDiscord.isConnected = true;
    const alertSpy = autoPressAlert('destructive');

    const screen = render(<DiscordSettingsScreen />);
    fireEvent.press(await screen.findByText('discord.refreshConnection'));

    // The OAuth flow must start: auth URL fetched and opened in the in-app browser.
    await waitFor(() => expect(mockDiscord.getDiscordAuthUrl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openedUrls()).toEqual([AUTH_URL]));

    // The claim must not be satisfied by the pre-existing (stale) link.
    await waitFor(() =>
      expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ requireFreshAuth: true })
      )
    );

    // Leaving the voice channel is not an account unlink and is not part of re-auth.
    expect(mockDiscord.disconnect).not.toHaveBeenCalled();
    // Confirmation dialog shown first.
    expect(alertSpy.mock.calls[0][0]).toBe('discord.refreshConfirmTitle');
  });

  it('does nothing when the user cancels the confirmation', async () => {
    autoPressAlert('cancel');
    const screen = render(<DiscordSettingsScreen />);
    fireEvent.press(await screen.findByText('discord.refreshConnection'));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDiscord.getDiscordAuthUrl).not.toHaveBeenCalled();
    expect(openedUrls()).toEqual([]);
  });
});
