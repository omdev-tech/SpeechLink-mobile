import {
  mockDiscord,
  resetDiscordMock,
  autoPressAlert,
  TEST_VERIFIER,
  TEST_CHALLENGE,
} from '../../../test-utils/discordScreenMocks';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import DiscordSettingsScreen from '../DiscordSettingsScreen';
import { resetDiscordCallbackLinksForTests } from '../../../services/discordCallbackLinks';
import { DiscordApiError } from '../../../services/discordService';

const REDIRECT = 'com.naqued.speechlinkmobile://discord-callback';
const H1 = 'h'.repeat(43);
const H2 = 'k'.repeat(43);
const pendingUrl = (h: string) => `${REDIRECT}?status=pending&handoff=${h}`;
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let alertSpy: jest.SpyInstance;
let emitUrl: (e: { url: string }) => void;
const alerts = () => alertSpy.mock.calls.map((c) => [c[0], c[1]]);

async function pressConnect() {
  const screen = render(<DiscordSettingsScreen />);
  fireEvent.press(await screen.findByText('discord.linkAccount'));
  await waitFor(() => expect(openAuthSession).toHaveBeenCalled());
  return screen;
}

describe('DiscordSettingsScreen - PKCE handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDiscordCallbackLinksForTests();
    resetDiscordMock({ isAuthenticated: false });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    emitUrl = () => {};
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('step 1 sends only the challenge: the verifier never leaves the app before completion', async () => {
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false);
    await pressConnect();
    expect(mockDiscord.getDiscordAuthUrl).toHaveBeenCalledWith(TEST_CHALLENGE);
    expect(JSON.stringify(mockDiscord.getDiscordAuthUrl.mock.calls)).not.toContain(TEST_VERIFIER);
  });

  it('pending redirect -> complete-handoff with the verifier of this flow, success alert', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: pendingUrl(H1) });
    await pressConnect();
    await waitFor(() => expect(alerts()).toEqual([['discord.authSuccess', 'discord.authSuccessMessage']]));
    expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(1);
    expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER);
    expect(mockDiscord.handleDiscordCallback).not.toHaveBeenCalled();
  });

  it('pending link without a flow started by this app instance -> no call, "please reconnect"', async () => {
    const screen = render(<DiscordSettingsScreen />);
    await screen.findByText('discord.linkAccount');
    await act(async () => emitUrl({ url: pendingUrl(H1) }));
    await flush();
    expect(mockDiscord.completeDiscordHandoff).not.toHaveBeenCalled();
    expect(alerts()).toEqual([['discord.authFailed', 'discord.reconnectNeeded']]);
  });

  it('verifier is single-use; a replayed link is handled once and a second handoff gets no call', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: pendingUrl(H1) });
    await pressConnect();
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(1));

    await act(async () => emitUrl({ url: pendingUrl(H1) })); // duplicate delivery
    await flush();
    await act(async () => emitUrl({ url: pendingUrl(H2) })); // another handoff, verifier already used
    await flush();

    expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(1);
    expect(alerts()).toEqual([
      ['discord.authSuccess', 'discord.authSuccessMessage'],
      ['discord.authFailed', 'discord.reconnectNeeded'],
    ]);
  });

  it('exchange_failed consumes the verifier (the code was spent): a further handoff gets no call', async () => {
    mockDiscord.completeDiscordHandoff.mockResolvedValue({ success: false, code: 'exchange_failed' });
    openAuthSession.mockResolvedValue({ type: 'success', url: pendingUrl(H1) });
    await pressConnect();
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(1));
    await act(async () => emitUrl({ url: pendingUrl(H2) }));
    await flush();
    expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(1);
  });

  it('an injected foreign pending link (invalid_handoff) does not burn the verifier: the real late link completes', async () => {
    const FOREIGN = 'f'.repeat(43);
    mockDiscord.completeDiscordHandoff.mockImplementation(async (h: string) =>
      h === H1 ? { success: true } : { success: false, code: 'invalid_handoff' }
    );
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false);
    await pressConnect();
    await flush();

    await act(async () => emitUrl({ url: pendingUrl(FOREIGN) })); // injected by another app
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(FOREIGN, TEST_VERIFIER));
    await act(async () => emitUrl({ url: pendingUrl(H1) })); // the real, late redirect
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER));
    await waitFor(() => expect(alerts()[alerts().length - 1]).toEqual(['discord.authSuccess', 'discord.authSuccessMessage']));

    // Success consumes it.
    await act(async () => emitUrl({ url: pendingUrl(H2) }));
    await flush();
    expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(2);
  });

  it('an injected malformed pending link does not burn the verifier either', async () => {
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false);
    await pressConnect();
    await flush();
    await act(async () => emitUrl({ url: `${REDIRECT}?status=pending&handoff=short` }));
    await flush();
    expect(mockDiscord.completeDiscordHandoff).not.toHaveBeenCalled();
    await act(async () => emitUrl({ url: pendingUrl(H1) }));
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER));
  });

  it.each([
    [10 * 60 * 1000 - 1, true],
    [10 * 60 * 1000 + 1, false],
  ])('a pending link %sms after the flow started is completed: %s (server TTL 10 min)', async (elapsed, completes) => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false);
    await pressConnect();
    await flush();
    now += elapsed;
    await act(async () => emitUrl({ url: pendingUrl(H1) }));
    await flush();
    if (completes) {
      await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER));
    } else {
      expect(mockDiscord.completeDiscordHandoff).not.toHaveBeenCalled();
      expect(alerts()).toEqual([['discord.authFailed', 'discord.reconnectNeeded']]);
    }
  });

  it('temporarily_unavailable -> "being updated, try again in a minute"', async () => {
    mockDiscord.completeDiscordHandoff.mockResolvedValue({ success: false, code: 'temporarily_unavailable' });
    openAuthSession.mockResolvedValue({ type: 'success', url: pendingUrl(H1) });
    await pressConnect();
    await waitFor(() => expect(alerts()).toEqual([['discord.authFailed', 'discord.temporarilyUnavailable']]));
  });

  it('Android: session resolves dismiss, pending link came via Linking -> completed once', async () => {
    let finishSession: (r: any) => void = () => {};
    openAuthSession.mockReturnValue(new Promise((resolve) => (finishSession = resolve)));
    await pressConnect();
    await act(async () => emitUrl({ url: pendingUrl(H1) }));
    await act(async () => finishSession({ type: 'dismiss' }));
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER));
    await act(async () => emitUrl({ url: pendingUrl(H1) }));
    await flush();
    expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledTimes(1);
    expect(alerts()).toEqual([['discord.authSuccess', 'discord.authSuccessMessage']]);
  });

  it('cancel, then the pending link arrives late -> still completed with this flow\'s verifier', async () => {
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false); // first-connect check-auth
    await pressConnect();
    await flush();
    await act(async () => emitUrl({ url: pendingUrl(H1) }));
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER));
    await waitFor(() => expect(alerts()).toEqual([['discord.authSuccess', 'discord.authSuccessMessage']]));
  });

  it.each([
    ['access_denied', 'discord.authCancelled', 'discord.authCancelledMessage'],
    ['rate_limited', 'discord.authFailed', 'discord.rateLimited'],
    ['exchange_failed', 'discord.authFailed', 'discord.authRetry'],
    ['invalid_state', 'discord.authFailed', 'discord.authFailedMessage'],
    ['server_error', 'discord.authFailed', 'discord.authFailedMessage'],
  ])('error redirect %s -> [%s, %s], nothing completed', async (code, title, message) => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?status=error&error=${code}` });
    await pressConnect();
    await waitFor(() => expect(alerts()).toEqual([[title, message]]));
    expect(mockDiscord.completeDiscordHandoff).not.toHaveBeenCalled();
  });

  it('completion failing with exchange_failed -> "please try again"', async () => {
    mockDiscord.completeDiscordHandoff.mockResolvedValue({ success: false, code: 'exchange_failed' });
    openAuthSession.mockResolvedValue({ type: 'success', url: pendingUrl(H1) });
    await pressConnect();
    await waitFor(() => expect(alerts()).toEqual([['discord.authFailed', 'discord.authRetry']]));
  });

  it('starting the flow is rate limited (429) -> "try again in a minute", no browser', async () => {
    mockDiscord.getDiscordAuthUrl.mockRejectedValue(new DiscordApiError('rate limited', 429, 'rate_limited'));
    const screen = render(<DiscordSettingsScreen />);
    fireEvent.press(await screen.findByText('discord.linkAccount'));
    await waitFor(() => expect(alerts()).toEqual([['discord.authFailed', 'discord.rateLimited']]));
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it('refresh (re-auth) via a pending handoff succeeds', async () => {
    resetDiscordMock({ isAuthenticated: true });
    alertSpy.mockRestore();
    alertSpy = autoPressAlert('destructive');
    openAuthSession.mockResolvedValue({ type: 'success', url: pendingUrl(H1) });
    const screen = render(<DiscordSettingsScreen />);
    fireEvent.press(await screen.findByText('discord.refreshConnection'));
    await waitFor(() => expect(mockDiscord.completeDiscordHandoff).toHaveBeenCalledWith(H1, TEST_VERIFIER));
    await waitFor(() => expect(alertSpy.mock.calls.map((c) => c[0])).toContain('discord.authSuccess'));
    expect(alertSpy.mock.calls.map((c) => c[0])).not.toContain('discord.authFailed');
  });
});
