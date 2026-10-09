jest.mock('../../services/authService', () => ({
  authService: {
    getToken: jest.fn(async () => ({ access_token: 'tok' })),
    onAuthenticationFailed: jest.fn(),
    saveToken: jest.fn(),
    clearToken: jest.fn(),
    refreshIfNeeded: jest.fn(async () => 'not_needed'),
    canLogoutEverywhere: jest.fn(async () => false),
    deleteAccount: jest.fn(),
  },
}));
jest.mock('../../services/apiService', () => ({ apiService: {} }));
jest.mock('../../services/googleAuthService', () => ({ __esModule: true, default: { startGoogleAuth: jest.fn() } }));
jest.mock('../../services/appleAuthService', () => ({
  signInWithApple: jest.fn(),
  isAppleSignInAvailable: jest.fn(),
  getAppleAuthorizationCode: jest.fn(),
}));

import React, { useContext } from 'react';
import { Text } from 'react-native';
import { render, act, screen, waitFor } from '@testing-library/react-native';
import { AuthContext, AuthProvider } from '../AuthContext';
import { authService } from '../../services/authService';
import { getAppleAuthorizationCode, isAppleSignInAvailable } from '../../services/appleAuthService';

const serviceDelete = authService.deleteAccount as jest.Mock;
const appleAvailable = isAppleSignInAvailable as jest.Mock;
const appleCode = getAppleAuthorizationCode as jest.Mock;

let ctx: React.ContextType<typeof AuthContext>;
function Probe() {
  ctx = useContext(AuthContext);
  return <Text testID="token">{ctx.token ?? 'none'}</Text>;
}

async function renderSignedIn() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('token').props.children).toBe('tok'));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('AuthContext.deleteAccount', () => {
  it('signs out locally once the account is deleted', async () => {
    await renderSignedIn();
    serviceDelete.mockResolvedValueOnce({ status: 'deleted' });
    let outcome;
    await act(async () => { outcome = await ctx.deleteAccount('fr'); });
    expect(outcome).toEqual({ status: 'deleted' });
    expect(serviceDelete).toHaveBeenCalledWith({ lang: 'fr' });
    expect(screen.getByTestId('token').props.children).toBe('none');
  });

  it('re-confirms with Apple on iOS and retries with the authorization code', async () => {
    await renderSignedIn();
    serviceDelete.mockResolvedValueOnce({ status: 'appleReauthRequired' }).mockResolvedValueOnce({ status: 'deleted' });
    appleAvailable.mockResolvedValue(true);
    appleCode.mockResolvedValue({ code: 'apple-code' });
    await act(async () => { await ctx.deleteAccount('en'); });
    expect(serviceDelete).toHaveBeenLastCalledWith({ lang: 'en', appleAuthorizationCode: 'apple-code' });
    expect(screen.getByTestId('token').props.children).toBe('none');
  });

  it('keeps the account and session when the user closes the Apple sheet', async () => {
    await renderSignedIn();
    serviceDelete.mockResolvedValueOnce({ status: 'appleReauthRequired' });
    appleAvailable.mockResolvedValue(true);
    appleCode.mockResolvedValue({ canceled: true });
    let outcome;
    await act(async () => { outcome = await ctx.deleteAccount(); });
    expect(outcome).toEqual({ status: 'canceled' });
    expect(serviceDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('token').props.children).toBe('tok');
  });

  it('on devices without Sign in with Apple, retries with appleUnavailable', async () => {
    await renderSignedIn();
    serviceDelete.mockResolvedValueOnce({ status: 'appleReauthRequired' }).mockResolvedValueOnce({ status: 'deleted' });
    appleAvailable.mockResolvedValue(false);
    await act(async () => { await ctx.deleteAccount('en'); });
    expect(appleCode).not.toHaveBeenCalled();
    expect(serviceDelete).toHaveBeenLastCalledWith({ lang: 'en', appleUnavailable: true });
  });

  it('keeps the session when deletion fails', async () => {
    await renderSignedIn();
    serviceDelete.mockResolvedValueOnce({ status: 'failed', code: 'HTTP_500' });
    await act(async () => { await ctx.deleteAccount(); });
    expect(screen.getByTestId('token').props.children).toBe('tok');
  });
});
