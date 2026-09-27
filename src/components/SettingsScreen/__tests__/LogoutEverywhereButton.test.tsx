jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import { AuthContext } from '../../../contexts/AuthContext';
import LogoutEverywhereButton from '../LogoutEverywhereButton';

type AlertButton = { text?: string; style?: string; onPress?: () => unknown };

describe('LogoutEverywhereButton', () => {
  let alertSpy: jest.SpyInstance;
  let signOutEverywhere: jest.Mock;

  const renderButton = () =>
    render(
      <AuthContext.Provider value={{ signOutEverywhere } as any}>
        <LogoutEverywhereButton />
      </AuthContext.Provider>
    );
  const lastButtons = (): AlertButton[] => alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2];

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    signOutEverywhere = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks for confirmation first and does nothing on cancel', () => {
    renderButton();
    fireEvent.press(screen.getByText('settings.logoutEverywhere'));
    expect(alertSpy).toHaveBeenCalledWith('settings.logoutEverywhere', 'settings.logoutEverywhereConfirm', expect.any(Array));
    const cancel = lastButtons().find((b) => b.style === 'cancel');
    cancel?.onPress?.();
    expect(signOutEverywhere).not.toHaveBeenCalled();
  });

  it('signs out everywhere once confirmed', async () => {
    renderButton();
    fireEvent.press(screen.getByText('settings.logoutEverywhere'));
    const confirm = lastButtons().find((b) => b.style === 'destructive');
    await act(async () => { await confirm?.onPress?.(); });
    expect(signOutEverywhere).toHaveBeenCalledTimes(1);
  });

  it('shows an error when the server could not end the sessions', async () => {
    signOutEverywhere.mockRejectedValue(new Error('logout-all failed: 503'));
    renderButton();
    fireEvent.press(screen.getByText('settings.logoutEverywhere'));
    const confirm = lastButtons().find((b) => b.style === 'destructive');
    await act(async () => { await confirm?.onPress?.(); });
    expect(alertSpy).toHaveBeenLastCalledWith('general.error.title', 'settings.logoutEverywhereError');
  });
});
