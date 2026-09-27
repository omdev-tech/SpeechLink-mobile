jest.mock('../../services/discordService', () => ({
  discordService: {
    getSettings: jest.fn(),
    getConnectionStatus: jest.fn(),
    handleCallback: jest.fn(),
  },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { DiscordProvider } from '../DiscordContext';
import { discordService } from '../../services/discordService';
import { resetDiscordCallbackLinksForTests } from '../../services/discordCallbackLinks';

const REDIRECT = 'com.naqued.speechlinkmobile://discord-callback';
const service = discordService as jest.Mocked<typeof discordService>;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('DiscordProvider - cold-start discord-callback link (app level, no Discord screen)', () => {
  let alertSpy: jest.SpyInstance;
  let initialUrl: jest.SpyInstance;
  const alertTitles = () => alertSpy.mock.calls.map((c) => c[0]);

  beforeEach(() => {
    resetDiscordCallbackLinksForTests();
    jest.clearAllMocks();
    service.getSettings.mockResolvedValue({ connected: true, isConnected: false } as any);
    service.getConnectionStatus.mockResolvedValue({ isConnected: false });
    service.handleCallback.mockResolvedValue(true);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    initialUrl = jest.spyOn(Linking, 'getInitialURL');
  });

  afterEach(() => jest.restoreAllMocks());

  it('claims a tempKey launch URL once, even if the provider re-mounts', async () => {
    initialUrl.mockResolvedValue(`${REDIRECT}?status=success&tempKey=K`);
    const first = render(<DiscordProvider>{null}</DiscordProvider>);
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    expect(service.handleCallback).toHaveBeenCalledTimes(1);
    expect(service.handleCallback).toHaveBeenCalledWith('', expect.objectContaining({ tempKey: 'K' }));

    first.unmount();
    render(<DiscordProvider>{null}</DiscordProvider>);
    await flush();
    await flush();
    expect(service.handleCallback).toHaveBeenCalledTimes(1);
    expect(alertTitles()).toEqual(['discord.authSuccess']);
  });

  it('linked=1 launch URL: confirmed link, settings reloaded, success alert', async () => {
    initialUrl.mockResolvedValue(`${REDIRECT}?status=success&linked=1`);
    render(<DiscordProvider>{null}</DiscordProvider>);
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authSuccess']));
    expect(service.handleCallback).toHaveBeenCalledWith('', expect.objectContaining({ linked: true }));
    // mount load + reload after the confirmed link
    await waitFor(() => expect(service.getSettings.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('error launch URL: failure alert, nothing claimed', async () => {
    initialUrl.mockResolvedValue(`${REDIRECT}?status=error&error=access_denied`);
    render(<DiscordProvider>{null}</DiscordProvider>);
    await waitFor(() => expect(alertTitles()).toEqual(['discord.authFailed']));
    expect(service.handleCallback).not.toHaveBeenCalled();
  });

  it('ignores unrelated launch URLs', async () => {
    initialUrl.mockResolvedValue('com.naqued.speechlinkmobile://something-else');
    render(<DiscordProvider>{null}</DiscordProvider>);
    await flush();
    await flush();
    expect(service.handleCallback).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
