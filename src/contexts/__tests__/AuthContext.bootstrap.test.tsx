jest.mock('../../services/authService', () => ({
  authService: {
    getToken: jest.fn(),
    onAuthenticationFailed: jest.fn(),
    saveToken: jest.fn(),
    clearToken: jest.fn(),
    refreshIfNeeded: jest.fn(async () => 'not_needed'),
  },
}));
jest.mock('../../services/apiService', () => ({ apiService: {} }));
jest.mock('../../services/googleAuthService', () => ({ __esModule: true, default: { startGoogleAuth: jest.fn() } }));

import React, { useContext } from 'react';
import { AppState, Text } from 'react-native';
import { render, act, screen } from '@testing-library/react-native';
import { AuthContext, AuthProvider } from '../AuthContext';
import { authService } from '../../services/authService';
import { SecureStorageUnavailableError } from '../../services/secureStorage';

const getToken = authService.getToken as jest.Mock;
const unavailable = () => new SecureStorageUnavailableError('keychain locked');

function TokenProbe() {
  const { token } = useContext(AuthContext);
  return <Text testID="token">{token ?? 'none'}</Text>;
}

describe('AuthProvider bootstrap when SecureStore is temporarily unreadable', () => {
  let appStateHandlers: Array<(s: string) => void>;
  let removeSpy: jest.Mock;
  let errSpy: jest.SpyInstance;

  const emit = async (state: string) => {
    await act(async () => {
      appStateHandlers.forEach((h) => h(state));
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  const runAllRetries = () => act(async () => { await jest.advanceTimersByTimeAsync(10_000); });

  beforeEach(() => {
    jest.useFakeTimers();
    getToken.mockReset();
    appStateHandlers = [];
    removeSpy = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: any, handler: any) => {
      appStateHandlers.push(handler);
      return { remove: removeSpy } as any;
    });
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('re-runs bootstrap on the next background -> active transition and restores the session', async () => {
    getToken.mockRejectedValue(unavailable());
    render(<AuthProvider><TokenProbe /></AuthProvider>);
    await runAllRetries();
    expect(getToken).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(screen.getByTestId('token').props.children).toBe('none');

    getToken.mockReset();
    getToken.mockResolvedValue({ access_token: 'tok' });
    await emit('background');
    await emit('active');
    await runAllRetries();
    expect(screen.getByTestId('token').props.children).toBe('tok');
    expect(removeSpy).toHaveBeenCalled(); // stops listening once recovered
  });

  it('re-runs once per transition (repeated "active" events do not stack runs)', async () => {
    getToken.mockRejectedValue(unavailable());
    render(<AuthProvider><TokenProbe /></AuthProvider>);
    await runAllRetries();
    getToken.mockClear();

    await emit('background');
    await emit('active');
    await emit('active');
    await runAllRetries();
    expect(getToken).toHaveBeenCalledTimes(4); // one bootstrap run (with its own retries)
    expect(screen.getByTestId('token').props.children).toBe('none');
  });

  it('does not subscribe when bootstrap succeeds or finds no token', async () => {
    getToken.mockResolvedValue(null);
    render(<AuthProvider><TokenProbe /></AuthProvider>);
    await runAllRetries();
    expect(appStateHandlers).toHaveLength(0);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
