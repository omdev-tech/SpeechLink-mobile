jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/aiConsentService', () => ({
  aiConsentService: { giveConsent: jest.fn(), hasConsented: jest.fn() },
}));

import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import { AuthContext } from '../../../contexts/AuthContext';
import { aiConsentService } from '../../../services/aiConsentService';
import AIConsentScreen from '../AIConsentScreen';

type AlertButton = { text?: string; style?: string; onPress?: () => unknown };

describe('AIConsentScreen', () => {
  let alertSpy: jest.SpyInstance;
  let signOut: jest.Mock;
  let onAccepted: jest.Mock;
  const giveConsent = aiConsentService.giveConsent as jest.Mock;

  const renderScreen = () =>
    render(
      <AuthContext.Provider value={{ signOut } as any}>
        <AIConsentScreen onAccepted={onAccepted} />
      </AuthContext.Provider>
    );
  const lastButtons = (): AlertButton[] => alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2];

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    signOut = jest.fn().mockResolvedValue(undefined);
    onAccepted = jest.fn();
    giveConsent.mockReset().mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('names every use of the data before asking', () => {
    renderScreen();
    for (const key of ['aiConsent.speechText', 'aiConsent.correctionText', 'aiConsent.voiceText']) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it('saves the consent and lets the user in when they agree', async () => {
    renderScreen();
    await act(async () => { fireEvent.press(screen.getByText('aiConsent.accept')); });
    expect(giveConsent).toHaveBeenCalled();
    expect(onAccepted).toHaveBeenCalled();
  });

  it('stays on the screen and says so when the consent cannot be saved', async () => {
    giveConsent.mockRejectedValue(new Error('storage down'));
    renderScreen();
    await act(async () => { fireEvent.press(screen.getByText('aiConsent.accept')); });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenLastCalledWith('general.error.title', 'aiConsent.saveError');
  });

  it('signs out only once declining is confirmed', () => {
    renderScreen();
    fireEvent.press(screen.getByText('aiConsent.decline'));
    expect(alertSpy).toHaveBeenCalledWith('aiConsent.declineTitle', 'aiConsent.declineMessage', expect.any(Array));
    lastButtons().find((b) => b.style === 'cancel')?.onPress?.();
    expect(signOut).not.toHaveBeenCalled();
    lastButtons().find((b) => b.style === 'destructive')?.onPress?.();
    expect(signOut).toHaveBeenCalled();
    expect(giveConsent).not.toHaveBeenCalled();
  });

  it('opens the privacy policy in the app language', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderScreen();
    fireEvent.press(screen.getByText('aiConsent.privacyLink'));
    expect(openURL).toHaveBeenCalledWith('https://speech-aac.link/fr/privacy');
  });
});
