import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Consent to send the user's voice and text to the third-party AI providers that run the core
 * features (App Store guideline 5.1.2(i)). Bump the version when the list of providers or the data
 * sent changes, so every user is asked again.
 */
const AI_CONSENT_KEY = 'ai_data_consent_v1';

class AIConsentService {
  /** True once the user has agreed on this device. A storage error counts as "not given". */
  async hasConsented(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(AI_CONSENT_KEY)) !== null;
    } catch (error) {
      console.error('[AIConsentService] Error reading consent:', error);
      return false;
    }
  }

  /** Records the consent with its date. */
  async giveConsent(): Promise<void> {
    await AsyncStorage.setItem(AI_CONSENT_KEY, new Date().toISOString());
  }
}

export const aiConsentService = new AIConsentService();
