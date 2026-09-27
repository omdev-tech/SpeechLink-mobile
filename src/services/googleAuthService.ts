import { API_CONFIG } from '../config/api';
import { AuthToken } from './authService';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

// Define response types
export interface GoogleAuthResponse {
  success: boolean;
  message?: string;
  access_token?: string;
  user?: {
    id: string;
    email?: string;
    name?: string;
    image?: string;
  };
}

// Custom scheme for redirects
const REDIRECT_URI = 'com.naqued.speechlinkmobile://auth/google/callback';

/**
 * Service for handling Google authentication for mobile
 */
class GoogleAuthService {
  private static instance: GoogleAuthService;
  
  private constructor() {}
  
  public static getInstance(): GoogleAuthService {
    if (!GoogleAuthService.instance) {
      GoogleAuthService.instance = new GoogleAuthService();
    }
    return GoogleAuthService.instance;
  }
  
  /**
   * Start the Google OAuth flow with deep linking (no polling needed)
   * @param accessToken Current user's access token (can be empty for initial login)
   * @returns Promise resolving to auth result
   */
  public async startGoogleAuth(accessToken: string): Promise<GoogleAuthResponse> {
    try {
      // Get the auth URL from our backend
      // Never log the auth URL, callback URL, tempKey or tokens: they are credentials.
      console.log('[GoogleAuth] starting flow', { hasAccessToken: !!accessToken });
      
      // Prepare headers - only include Authorization if we have a token
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/google`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          operation: 'get-auth-url',
          redirectUri: REDIRECT_URI // Send the redirect URI to backend
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[GoogleAuth] failed to get auth URL:', response.status, errorData?.error);
        throw new Error(errorData.error || 'Failed to start Google authentication');
      }
      
      const data = await response.json();
      
      if (!data.authUrl) {
        throw new Error('Invalid auth URL response from server');
      }
      
      console.log('[GoogleAuth] opening auth session');
      
      // Use openAuthSessionAsync which automatically handles the redirect
      const result = await WebBrowser.openAuthSessionAsync(data.authUrl, REDIRECT_URI);
      
      // result.url carries the tempKey — log only the outcome type.
      console.log('[GoogleAuth] auth session result:', result.type);
      
      if (result.type === 'success' && result.url) {
        // Parse the redirect URL to get the token or temp key
        return await this.handleAuthCallback(result.url, accessToken);
      } else if (result.type === 'cancel') {
        return {
          success: false,
          message: 'Authentication cancelled by user'
        };
      } else {
        return {
          success: false,
          message: 'Authentication failed'
        };
      }
    } catch (error) {
      console.error('[GoogleAuth] error starting flow:', error instanceof Error ? error.message : 'unknown error');
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start Google authentication'
      };
    }
  }
  
  /**
   * Handle the auth callback URL
   * @param url The callback URL with parameters
   * @param accessToken Current user's access token
   * @returns Promise resolving to auth result
   */
  private async handleAuthCallback(url: string, accessToken: string): Promise<GoogleAuthResponse> {
    try {
      // Parse URL parameters (the URL and params hold the tempKey — never log them)
      const params = Linking.parse(url).queryParams;
      
      const tempKey = params?.tempKey as string;
      const error = params?.error as string;
      
      if (error) {
        console.error('[GoogleAuth] callback returned an error:', error);
        return {
          success: false,
          message: error || 'Authentication failed'
        };
      }
      
      if (!tempKey) {
        console.error('[GoogleAuth] no temp key in callback URL');
        return {
          success: false,
          message: 'Invalid authentication response'
        };
      }
      
      // Verify and claim the key
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      console.log('[GoogleAuth] verifying temp key');
      const verifyResponse = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/google`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'verify-temp-key',
          tempKey
        })
      });
      
      const verifyData = await verifyResponse.json();
      
      if (!verifyResponse.ok || !verifyData.success) {
        console.error('[GoogleAuth] temp key verification failed:', verifyResponse.status, verifyData?.error);
        return {
          success: false,
          message: verifyData.error || 'Failed to verify authentication'
        };
      }
      
      console.log('[GoogleAuth] authentication successful');
      
      return {
        success: true,
        message: 'Successfully authenticated with Google',
        access_token: verifyData.access_token,
        user: verifyData.user
      };
    } catch (error) {
      console.error('[GoogleAuth] error handling callback:', error instanceof Error ? error.message : 'unknown error');
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to complete authentication'
      };
    }
  }
}

export default GoogleAuthService.getInstance(); 