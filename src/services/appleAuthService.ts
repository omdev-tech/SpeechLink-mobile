import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { API_CONFIG } from '../config/api';

export interface AppleAuthResult {
  success: boolean;
  /** The user closed the Apple sheet: not an error to show. */
  canceled?: boolean;
  message?: string;
  access_token?: string;
  expires_at?: number;
  expires_in?: number;
}

/** Sign in with Apple is offered on iOS devices that support it. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Native Sign in with Apple. Apple receives sha256(rawNonce) and echoes it in the identity
 * token; the backend gets the raw nonce and checks the hash, so a token cannot be replayed.
 */
export async function signInWithApple(): Promise<AppleAuthResult> {
  const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error: any) {
    if (error?.code === 'ERR_REQUEST_CANCELED') return { success: false, canceled: true };
    return { success: false, message: 'Apple sign-in failed. Please try again.' };
  }

  if (!credential.identityToken) {
    return { success: false, message: 'Apple sign-in failed. Please try again.' };
  }

  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/apple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identityToken: credential.identityToken,
        rawNonce,
        // Apple only shares the name on the very first authorization
        fullName: credential.fullName
          ? { givenName: credential.fullName.givenName, familyName: credential.fullName.familyName }
          : null,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      return { success: false, message: data?.error || 'Apple sign-in failed. Please try again.' };
    }
    return { success: true, access_token: data.access_token, expires_at: data.expires_at, expires_in: data.expires_in };
  } catch {
    return { success: false, message: 'Could not reach the server. Check your connection and try again.' };
  }
}
