jest.mock('../MainNavigator', () => {
  const { Text } = require('react-native');
  return () => <Text>main-app</Text>;
});
jest.mock('../AuthNavigator', () => {
  const { Text } = require('react-native');
  return { AuthNavigator: () => <Text>login</Text> };
});
jest.mock('../../screens/AIConsent/AIConsentScreen', () => {
  const { Text } = require('react-native');
  return ({ onAccepted }: { onAccepted: () => void }) => <Text onPress={onAccepted}>consent</Text>;
});
jest.mock('../../services/aiConsentService', () => ({
  aiConsentService: { hasConsented: jest.fn(), giveConsent: jest.fn() },
}));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { AuthContext } from '../../contexts/AuthContext';
import { aiConsentService } from '../../services/aiConsentService';
import RootNavigator from '../RootNavigator';

const hasConsented = aiConsentService.hasConsented as jest.Mock;

const renderWithToken = (token: string | null) =>
  render(
    <AuthContext.Provider value={{ token } as any}>
      <RootNavigator />
    </AuthContext.Provider>
  );

describe('RootNavigator AI consent gate', () => {
  beforeEach(() => hasConsented.mockReset());

  it('shows login when signed out, without reading the consent', () => {
    renderWithToken(null);
    expect(screen.getByText('login')).toBeTruthy();
    expect(hasConsented).not.toHaveBeenCalled();
  });

  it('asks for consent before mounting the app, then opens it once given', async () => {
    hasConsented.mockResolvedValue(false);
    renderWithToken('token');
    expect(await screen.findByText('consent')).toBeTruthy();
    expect(screen.queryByText('main-app')).toBeNull();
    fireEvent.press(screen.getByText('consent'));
    expect(screen.getByText('main-app')).toBeTruthy();
  });

  it('opens the app directly when consent was already given', async () => {
    hasConsented.mockResolvedValue(true);
    renderWithToken('token');
    expect(await screen.findByText('main-app')).toBeTruthy();
    expect(screen.queryByText('consent')).toBeNull();
  });
});
