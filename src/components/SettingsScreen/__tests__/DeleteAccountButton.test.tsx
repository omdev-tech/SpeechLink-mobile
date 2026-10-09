jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import { AuthContext } from '../../../contexts/AuthContext';
import DeleteAccountButton from '../DeleteAccountButton';

type AlertButton = { text?: string; style?: string; onPress?: () => unknown };

describe('DeleteAccountButton', () => {
  let alertSpy: jest.SpyInstance;
  let deleteAccount: jest.Mock;

  const renderButton = () =>
    render(
      <AuthContext.Provider value={{ deleteAccount } as any}>
        <DeleteAccountButton />
      </AuthContext.Provider>
    );
  const lastButtons = (): AlertButton[] => alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2];
  const confirmDeletion = async () => {
    fireEvent.press(screen.getByText('account.delete.button'));
    const destructive = lastButtons().find((b) => b.style === 'destructive');
    await act(async () => { await destructive?.onPress?.(); });
  };

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    deleteAccount = jest.fn().mockResolvedValue({ status: 'deleted' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks for confirmation first and does nothing on cancel', () => {
    renderButton();
    fireEvent.press(screen.getByText('account.delete.button'));
    expect(alertSpy).toHaveBeenCalledWith('account.delete.confirmTitle', 'account.delete.confirmMessage', expect.any(Array));
    lastButtons().find((b) => b.style === 'cancel')?.onPress?.();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes in the app language once confirmed and says so', async () => {
    renderButton();
    await confirmDeletion();
    expect(deleteAccount).toHaveBeenCalledWith('fr');
    expect(alertSpy).toHaveBeenLastCalledWith('account.delete.doneTitle', 'account.delete.doneMessage');
  });

  it('explains a failed subscription cancellation', async () => {
    deleteAccount.mockResolvedValue({ status: 'failed', code: 'SUBSCRIPTION_CANCEL_FAILED' });
    renderButton();
    await confirmDeletion();
    expect(alertSpy).toHaveBeenLastCalledWith('general.error.title', 'account.delete.subscriptionError');
  });

  it('shows a generic error otherwise, and nothing when Apple was canceled', async () => {
    deleteAccount.mockResolvedValueOnce({ status: 'failed', code: 'HTTP_500' });
    renderButton();
    await confirmDeletion();
    expect(alertSpy).toHaveBeenLastCalledWith('general.error.title', 'account.delete.error');

    deleteAccount.mockResolvedValueOnce({ status: 'canceled' });
    const callsBefore = alertSpy.mock.calls.length;
    await confirmDeletion();
    expect(alertSpy.mock.calls.length).toBe(callsBefore + 1); // only the confirmation dialog
  });
});
