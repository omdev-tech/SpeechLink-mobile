import { mockDiscord, resetDiscordMock, AUTH_URL } from '../../../test-utils/discordScreenMocks';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import DiscordSettingsScreen from '../DiscordSettingsScreen';

const REDIRECT = 'com.naqued.speechlinkmobile://discord-callback';
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

let alertSpy: jest.SpyInstance;
const alertTitles = () => alertSpy.mock.calls.map((c) => c[0]);

async function pressConnect() {
  const screen = render(<DiscordSettingsScreen />);
  fireEvent.press(await screen.findByText('discord.linkAccount'));
  await waitFor(() => expect(openAuthSession).toHaveBeenCalled());
  return screen;
}

describe('DiscordSettingsScreen - Discord OAuth in an auth session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDiscordMock({ isAuthenticated: false });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('opens the auth URL with openAuthSessionAsync and the app deep link, never a plain browser tab', async () => {
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false);
    await pressConnect();
    expect(openAuthSession).toHaveBeenCalledWith(AUTH_URL, REDIRECT);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('success redirect with tempKey: claims that key and reports success', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?status=success&tempKey=abc123` });
    await pressConnect();
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1);
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledWith('', expect.objectContaining({ tempKey: 'abc123' }));
  });

  it('success redirect with a raw code: exchanges the code', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?code=the%2Fcode` });
    await pressConnect();
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledWith('the/code', expect.anything());
  });

  it('success redirect with status=success only (first connect): no key to claim, one check-auth decides', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?status=success` });
    await pressConnect();
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    const [, options] = mockDiscord.handleDiscordCallback.mock.calls[0];
    expect(options.requireFreshAuth).toBeFalsy();
  });

  it.each([
    [`${REDIRECT}?status=error`],
    [`${REDIRECT}?error=access_denied`],
  ])('error redirect (%s): reports failure without claiming anything', async (url) => {
    openAuthSession.mockResolvedValue({ type: 'success', url });
    await pressConnect();
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authFailed']));
    expect(mockDiscord.handleDiscordCallback).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'dismiss'])(
    '%s after completing OAuth on a page that did not redirect: one check-auth, no polling',
    async (type) => {
      openAuthSession.mockResolvedValue({ type });
      mockDiscord.handleDiscordCallback.mockResolvedValue(true);
      await pressConnect();
      await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
      expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1);
      const [code, options] = mockDiscord.handleDiscordCallback.mock.calls[0];
      expect(code).toBe('');
      expect(options.tempKey).toBeUndefined();
      expect(options.requireFreshAuth).toBe(false);
    }
  );

  it.each(['cancel', 'dismiss'])('%s without completing OAuth: silent, spinner cleared', async (type) => {
    openAuthSession.mockResolvedValue({ type });
    mockDiscord.handleDiscordCallback.mockResolvedValue(false);
    const screen = await pressConnect();
    await waitFor(() => expect(mockDiscord.handleDiscordCallback).toHaveBeenCalled());
    expect(await screen.findByText('discord.linkAccount')).toBeTruthy(); // not the spinner anymore
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('ignores the global deep-link event while the auth session owns the round-trip', async () => {
    let emitUrl: (e: { url: string }) => void = () => {};
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as any);

    let finishSession: (r: any) => void = () => {};
    openAuthSession.mockReturnValue(new Promise((resolve) => (finishSession = resolve)));

    await pressConnect();
    // Android delivers the redirect to both openAuthSessionAsync and the app's Linking listener.
    const url = `${REDIRECT}?status=success&tempKey=k`;
    await act(async () => emitUrl({ url }));
    expect(mockDiscord.handleDiscordCallback).not.toHaveBeenCalled();

    await act(async () => finishSession({ type: 'success', url }));
    await waitFor(() => expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1));
  });

  it('handles a discord-callback deep link that arrives outside an auth session', async () => {
    let emitUrl: (e: { url: string }) => void = () => {};
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as any);

    const screen = render(<DiscordSettingsScreen />);
    await screen.findByText('discord.linkAccount');
    await act(async () => emitUrl({ url: `${REDIRECT}?status=success&tempKey=late` }));
    await waitFor(() =>
      expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledWith('', expect.objectContaining({ tempKey: 'late' }))
    );
  });

  it('Android: session resolves "dismiss" but the redirect arrived via Linking -> uses it, once', async () => {
    let emitUrl: (e: { url: string }) => void = () => {};
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as any);

    let finishSession: (r: any) => void = () => {};
    openAuthSession.mockReturnValue(new Promise((resolve) => (finishSession = resolve)));

    await pressConnect();
    const url = `${REDIRECT}?status=success&tempKey=android`;
    await act(async () => emitUrl({ url }));
    await act(async () => finishSession({ type: 'dismiss' }));
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1);
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledWith('', expect.objectContaining({ tempKey: 'android' }));

    // A late (duplicate) delivery of the same redirect must not be handled again.
    await act(async () => emitUrl({ url }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1);
    expect(alertTitles()).toEqual(['discord.authSuccess']);
  });

  it('late duplicate of a redirect already handled by the auth session is ignored', async () => {
    let emitUrl: (e: { url: string }) => void = () => {};
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      emitUrl = handler;
      return { remove: jest.fn() };
    }) as any);
    const url = `${REDIRECT}?status=success&tempKey=dup`;
    openAuthSession.mockResolvedValue({ type: 'success', url });

    await pressConnect();
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    await act(async () => emitUrl({ url }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDiscord.handleDiscordCallback).toHaveBeenCalledTimes(1);
    expect(alertTitles()).toEqual(['discord.authSuccess']);
  });
});
