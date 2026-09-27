import * as secureStorage from './secureStorage';
import { API_CONFIG } from '../config/api';
import { 
  login, 
  register, 
  refreshTokens, 
  requestPasswordReset, 
  resetPassword, 
  logout as apiLogout 
} from '../api/auth';
import { 
  LoginCredentials, 
  RegisterCredentials, 
  AuthResponse, 
  PasswordResetConfirm 
} from '../types/auth';

export interface AuthToken {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  accessToken?: string;  // Alternative NextAuth format
  userId?: string;       // User ID extracted from token
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// Define callbacks to be used for auth events
type AuthEventCallback = () => void;

class AuthService {
  private static instance: AuthService;
  private token: AuthToken | null = null;
  private tokenRefreshInProgress: boolean = false;
  private authFailedCallbacks: AuthEventCallback[] = [];
  private refreshTokenPromise: Promise<boolean> | null = null;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // Register a callback for when authentication fails
  public onAuthenticationFailed(callback: AuthEventCallback): void {
    this.authFailedCallbacks.push(callback);
  }

  // Trigger auth failed callbacks
  public triggerAuthFailedCallbacks(): void {
    this.authFailedCallbacks.forEach(callback => callback());
  }

  /**
   * Login with email and password
   */
  public async loginWithCredentials(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      // Call the login API
      const response = await login(credentials);
      
      // Format and save the token
      const tokenObj: AuthToken = {
        access_token: response.accessToken || response.access_token || '',
        token_type: 'bearer',
        user: response.user,
        userId: response.user?.id
      };
      
      await this.saveToken(tokenObj);
      return response;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  /**
   * Register a new user
   */
  public async registerUser(credentials: RegisterCredentials): Promise<AuthResponse> {
    try {
      const response = await register(credentials);
      return response;
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  public async requestPasswordReset(email: string): Promise<{success: boolean}> {
    try {
      return await requestPasswordReset(email);
    } catch (error) {
      console.error('Password reset request failed:', error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  public async resetPassword(resetData: PasswordResetConfirm): Promise<{success: boolean}> {
    try {
      return await resetPassword(resetData);
    } catch (error) {
      console.error('Password reset failed:', error);
      throw error;
    }
  }

  /**
   * Logout the user
   */
  public async logout(): Promise<void> {
    try {
      // Call the logout API
      await apiLogout();
    } catch (error) {
      console.error('Logout API call failed:', error);
      // Continue with local cleanup even if API call fails
    }
    
    // Clear stored tokens
    await this.clearToken();
  }

  /**
   * Refresh the access token
   */
  public async refreshAccessToken(): Promise<boolean> {
    // Prevent multiple concurrent refresh attempts
    if (this.refreshTokenPromise) {
      return this.refreshTokenPromise;
    }

    this.refreshTokenPromise = (async () => {
      try {
        // Get the current access token
        const currentToken = await this.getToken();
        if (!currentToken || !currentToken.access_token) {
          throw new Error('No access token available to refresh');
        }

        console.log('[Auth] Attempting to refresh token');

        // Call the mobile refresh endpoint with the current token
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: currentToken.access_token })
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error('[Auth] Token refresh failed:', response.status, errorData);
          throw new Error(`Token refresh failed: ${response.status}`);
        }

        const data = await response.json();
        
        // Update the stored token with the new one
        const tokenObj: AuthToken = {
          access_token: data.access_token,
          token_type: 'bearer',
          user: data.user
        };
        
        await this.saveToken(tokenObj);
        console.log('[Auth] Token refresh successful');
        return true;
      } catch (error) {
        console.error('[Auth] Token refresh failed:', error);
        // If refresh fails, log the user out
        await this.clearToken();
        this.triggerAuthFailedCallbacks();
        return false;
      } finally {
        this.refreshTokenPromise = null;
      }
    })();

    return this.refreshTokenPromise;
  }

  public async getDevelopmentToken(): Promise<AuthToken> {
    try {
      // Prevent multiple concurrent token refresh attempts
      if (this.tokenRefreshInProgress) {
        // Wait for existing refresh to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.token) {
          console.log('Using cached dev token (token refresh in progress)');
          return this.token;
        }
      }

      this.tokenRefreshInProgress = true;
      console.log('Fetching development token...');
      
      try {
        console.log(`Making request to: ${API_CONFIG.BASE_URL}/api/dev-auth`);
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/dev-auth`);
        
        console.log('Dev auth response status:', response.status);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch development token: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Dev token response structure:', Object.keys(data));
        
        // Only update if we actually got a token
        if (data && data.access_token) {
          // Add additional fields required by NextAuth format
          const enhancedToken = {
            ...data,
            // Add token_type if missing
            token_type: data.token_type || 'bearer',
            // Format field that NextAuth might expect
            accessToken: data.access_token,
            userId: data.user?.id
          };
          
          this.token = enhancedToken;
          await this.saveToken(enhancedToken);
          console.log('Successfully saved development token with enhanced fields');
          return enhancedToken;
        } else {
          console.error('Invalid token response - missing access_token:', data);
          throw new Error('Invalid token response');
        }
      } catch (error) {
        console.error('Error fetching development token:', error);
        // Trigger auth failed callbacks on serious errors
        this.triggerAuthFailedCallbacks();
        throw error;
      } finally {
        this.tokenRefreshInProgress = false;
      }
    } catch (error) {
      console.error('Error in getDevelopmentToken:', error);
      throw error;
    }
  }

  public async getToken(): Promise<AuthToken | null> {
    if (this.token) {
      return this.token;
    }

    try {
      const storedToken = await secureStorage.getToken();
      if (storedToken) {
        this.token = { access_token: storedToken, token_type: 'bearer' };
        return this.token;
      }
    } catch (error) {
      console.error('Error retrieving stored token:', error);
    }

    return null;
  }

  public async saveToken(token: AuthToken): Promise<void> {
    try {
      this.token = token;
      // Check and warn if we're missing expected fields
      if (!token.access_token) {
        console.warn('Warning: Token is missing access_token field');
      }
      console.log('Saving token with structure:', {
        hasAccessToken: !!token.access_token,
        accessTokenLength: token.access_token ? token.access_token.length : 0,
        hasTokenType: !!token.token_type,
        hasExpiresIn: !!token.expires_in,
      });
      
      await secureStorage.setToken(token.access_token);
    } catch (error) {
      console.error('Error saving token:', error);
    }
  }

  public async clearToken(): Promise<void> {
    try {
      this.token = null;
      await secureStorage.clearTokens();
    } catch (error) {
      console.error('Error clearing token:', error);
    }
  }

  public async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }

  // Handle an auth error by clearing token and redirecting
  public async handleAuthError(): Promise<void> {
    // Clear the token since it's invalid
    await this.clearToken();
    // Notify listeners that auth has failed
    this.triggerAuthFailedCallbacks();
  }
}

export const authService = AuthService.getInstance(); 