import AsyncStorage from '@react-native-async-storage/async-storage';
import { aiConsentService } from '../aiConsentService';

describe('aiConsentService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('has no consent until it is given', async () => {
    expect(await aiConsentService.hasConsented()).toBe(false);
  });

  it('remembers the consent with its date', async () => {
    await aiConsentService.giveConsent();
    expect(await aiConsentService.hasConsented()).toBe(true);
    const stored = await AsyncStorage.getItem('ai_data_consent_v1');
    expect(Number.isNaN(Date.parse(stored as string))).toBe(false);
  });

  it('treats a storage error as no consent', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage down'));
    expect(await aiConsentService.hasConsented()).toBe(false);
  });
});
