jest.mock('../../services/authService', () => ({
  authService: {
    getToken: jest.fn(),
    onAuthenticationFailed: jest.fn(),
    saveToken: jest.fn(),
    clearToken: jest.fn(),
    refreshIfNeeded: jest.fn(),
    logoutEverywhere: jest.fn(),
  },
}));
jest.mock('../../services/apiService', () => ({ apiService: {} }));
jest.mock('../../services/googleAuthService', () => ({ __esModule: true, default: { startGoogleAuth: jest.fn() } }));

import React, { useContext } from 'react';
import { AppState, Text } from 'react-native';
import { render, act, screen } from '@testing-library/react-native';
import { AuthContext, AuthProvider } from '../AuthContext';
import { authService } from '../../services/authService';

const svc = authService as unknown as Record<string, jest.Mock>;

let ctx: React.ContextType<typeof AuthContext>;
function Probe() {
  ctx = useContext(AuthContext);
  return <Text testID="token">{ctx.token ?? 'none'}</Text>;
}
const shownToken = () => screen.getByTestId('token').props.children;

describe('AuthProvider proactive refresh + log out everywhere', () => {
  let appStateHandlers: Array<(s: string) => void>;

  const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(0); });
  const emit = async (state: string) => {
    await act(async () => {
      appStateHandlers.forEach((h) => h(state));
      await jest.advanceTimersByTimeAsync(0);
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    Object.values(svc).forEach((m) => m.mockReset());
    svc.refreshIfNeeded.mockResolvedValue('not_needed');
    appStateHandlers = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: any, handler: any) => {
      appStateHandlers.push(handler);
      return { remove: jest.fn() } as any;
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('checks for a proactive refresh on launch when signed in, and adopts the refreshed token', async () => {
    svc.getToken.mockResolvedValueOnce({ access_token: 'old' }).mockResolvedValue({ access_token: 'new' });
    svc.refreshIfNeeded.mockResolvedValueOnce('refreshed');
    render(<AuthProvider><Probe /></AuthProvider>);
    await flush();
    await flush();
    expect(svc.refreshIfNeeded).toHaveBeenCalledTimes(1);
    expect(shownToken()).toBe('new');
  });

  it('checks again each time the app returns to the foreground', async () => {
    svc.getToken.mockResolvedValue({ access_token: 'tok' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await flush();
    expect(svc.refreshIfNeeded).toHaveBeenCalledTimes(1);

    await emit('background');
    await emit('active');
    expect(svc.refreshIfNeeded).toHaveBeenCalledTimes(2);
    expect(shownToken()).toBe('tok');
  });

  it('does not check when signed out', async () => {
    svc.getToken.mockResolvedValue(null);
    render(<AuthProvider><Probe /></AuthProvider>);
    await flush();
    await emit('background');
    await emit('active');
    expect(svc.refreshIfNeeded).not.toHaveBeenCalled();
  });

  it('a transient refresh failure keeps the user signed in', async () => {
    svc.getToken.mockResolvedValue({ access_token: 'tok' });
    svc.refreshIfNeeded.mockResolvedValue('transient');
    render(<AuthProvider><Probe /></AuthProvider>);
    await flush();
    expect(shownToken()).toBe('tok');
    expect(svc.clearToken).not.toHaveBeenCalled();
  });

  it('signOutEverywhere ends all sessions and returns to login (token cleared)', async () => {
    svc.getToken.mockResolvedValue({ access_token: 'tok' });
    svc.logoutEverywhere.mockResolvedValue(undefined);
    render(<AuthProvider><Probe /></AuthProvider>);
    await flush();
    expect(shownToken()).toBe('tok');

    await act(async () => { await ctx.signOutEverywhere(); });
    expect(svc.logoutEverywhere).toHaveBeenCalledTimes(1);
    expect(shownToken()).toBe('none');
  });

  it('signOutEverywhere failure keeps this session and surfaces the error', async () => {
    svc.getToken.mockResolvedValue({ access_token: 'tok' });
    svc.logoutEverywhere.mockRejectedValue(new Error('logout-all failed: 503'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await flush();

    await act(async () => {
      await expect(ctx.signOutEverywhere()).rejects.toThrow('503');
    });
    expect(shownToken()).toBe('tok');
  });
});
