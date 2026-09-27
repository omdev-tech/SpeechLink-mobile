import axios from 'axios';
import * as secureStorage from '../services/secureStorage';
import { API_CONFIG } from '../config/api';
import { 
  LoginCredentials, 
  RegisterCredentials, 
  AuthResponse, 
  PasswordResetRequest, 
  PasswordResetConfirm,
  TokenPair,
  AuthError
} from '../types/auth';

const apiClient = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'X-Client-Type': 'mobile-app'
  },
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  const token = await secureStorage.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Login with email and password
 */
export const login = async (credentials: LoginCredentials): Promise<AuthResponse> => {
  try {
    console.log('Sending login request to server');
    
    const response = await apiClient.post('/api/auth/mobile-login', credentials);
    
    console.log('Login success response:', {
      status: response.status,
      dataKeys: Object.keys(response.data),
      hasAccessToken: !!response.data.access_token,
      hasToken: !!response.data.token, // Some APIs might use 'token' instead
      hasRefreshToken: !!response.data.refreshToken,
      hasUser: !!response.data.user
    });
    
    // Handle new response format from mobile-login endpoint
    const responseData = response.data;
    
    // If response uses access_token format (new mobile endpoint)
    if (responseData.access_token && !responseData.accessToken) {
      responseData.accessToken = responseData.access_token;
      console.log('Used access_token field as accessToken');
    } else if (responseData.token && !responseData.accessToken) {
      // Fallback for token field naming
      responseData.accessToken = responseData.token;
      console.log('Used token field as accessToken');
    }
    
    // If we have both tokens, store them
    if (responseData.accessToken && responseData.refreshToken) {
      await storeAuthTokens(responseData.accessToken, responseData.refreshToken);
      console.log('Successfully stored authentication tokens after login');
    } else if (responseData.accessToken) {
      // If we only have access token, just store that
      await secureStorage.setToken(responseData.accessToken);
      console.log('Stored only access token (no refresh token)');
    } else {
      console.warn('No tokens received in login response');
    }
    
    return responseData;
  } catch (error) {
    console.error('Login API error detailed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      isAxiosError: axios.isAxiosError(error),
      status: axios.isAxiosError(error) ? error.response?.status : undefined,
      data: axios.isAxiosError(error) ? error.response?.data : undefined,
      headers: axios.isAxiosError(error) ? error.response?.headers : undefined
    });
    
    handleAuthError(error);
    throw error;
  }
};

/**
 * Register a new user
 */
export const register = async (credentials: RegisterCredentials): Promise<AuthResponse> => {
  try {
    console.log('Sending registration request to server');
    
    const response = await apiClient.post('/api/auth/mobile-register', credentials);
    
    console.log('Registration success response:', {
      status: response.status,
      dataKeys: Object.keys(response.data),
      hasAccessToken: !!response.data.access_token,
      hasToken: !!response.data.token, // Some APIs might use 'token' instead
      hasRefreshToken: !!response.data.refreshToken,
      hasUser: !!response.data.user
    });
    
    // Handle new response format from mobile-register endpoint
    const responseData = response.data;
    
    // If response uses access_token format (new mobile endpoint)
    if (responseData.access_token && !responseData.accessToken) {
      responseData.accessToken = responseData.access_token;
      console.log('Used access_token field as accessToken');
    } else if (responseData.token && !responseData.accessToken) {
      // Fallback for token field naming
      responseData.accessToken = responseData.token;
      console.log('Used token field as accessToken');
    }
    
    // If we have both tokens, store them
    if (responseData.accessToken && responseData.refreshToken) {
      await storeAuthTokens(responseData.accessToken, responseData.refreshToken);
      console.log('Successfully stored authentication tokens after registration');
    } else if (responseData.accessToken) {
      // If we only have access token, just store that
      await secureStorage.setToken(responseData.accessToken);
      console.log('Stored only access token (no refresh token)');
    } else {
      console.warn('No tokens received in registration response');
    }
    
    return responseData;
  } catch (error) {
    console.error('Registration API error detailed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      isAxiosError: axios.isAxiosError(error),
      status: axios.isAxiosError(error) ? error.response?.status : undefined,
      data: axios.isAxiosError(error) ? error.response?.data : undefined,
      headers: axios.isAxiosError(error) ? error.response?.headers : undefined
    });
    
    handleAuthError(error);
    throw error;
  }
};

/**
 * Request a password reset email
 */
export const requestPasswordReset = async (email: string): Promise<{ success: boolean }> => {
  try {
    const response = await apiClient.post('/api/auth/mobile-forgot-password', { email });
    return response.data;
  } catch (error) {
    handleAuthError(error);
    throw error;
  }
};

/**
 * Reset password with token
 */
export const resetPassword = async (resetData: PasswordResetConfirm): Promise<{ success: boolean }> => {
  try {
    const response = await apiClient.post('/api/auth/mobile-reset-password', resetData);
    return response.data;
  } catch (error) {
    handleAuthError(error);
    throw error;
  }
};

/**
 * Refresh the access token using the refresh token
 */
export const refreshTokens = async (refreshToken: string): Promise<TokenPair> => {
  try {
    const response = await apiClient.post('/api/auth/refresh', { refreshToken });
    
    // Store the new tokens
    await storeAuthTokens(response.data.accessToken, response.data.refreshToken);
    
    return response.data;
  } catch (error) {
    handleAuthError(error);
    throw error;
  }
};

/**
 * Logout the user
 */
export const logout = async () => {
  try {
    // Call the logout endpoint
    await apiClient.post('/api/auth/mobile/logout');
    
    // Clear tokens from storage
    await secureStorage.clearTokens();
    
    return { success: true };
  } catch (error) {
    console.error('Logout failed:', error);
    
    // Even if the API call fails, clear tokens locally
    await secureStorage.clearTokens();
    
    throw error;
  }
}; 

/**
 * Store authentication tokens securely
 */
const storeAuthTokens = async (accessToken?: string | null, refreshToken?: string | null) => {
  console.log('Storing auth tokens:', {
    hasAccessToken: !!accessToken,
    accessTokenLength: accessToken ? accessToken.length : 0,
    hasRefreshToken: !!refreshToken
  });
  
  try {
    if (accessToken) {
      await secureStorage.setToken(accessToken);
    } else {
      console.warn('Attempted to store null/undefined access token');
    }
    
    if (refreshToken) {
      await secureStorage.setRefreshToken(refreshToken);
    }
  } catch (error) {
    console.error('Error storing auth tokens:', error);
    throw error;
  }
};

/**
 * Handle authentication errors
 */
const handleAuthError = (error: any) => {
  if (axios.isAxiosError(error)) {
    // Get the response data in whatever format it's in
    const responseData = error.response?.data;
    
    console.error('Auth error response data:', JSON.stringify(responseData));
    
    // Make our best attempt to standardize the error data
    const errorData: AuthError = {
      error: responseData?.error || responseData?.message || 'Authentication failed',
      code: responseData?.code || responseData?.statusCode || error.response?.status?.toString() || 'UNKNOWN_ERROR',
      details: responseData?.details || responseData?.errors || {}
    };
    
    console.error('Auth API error standardized:', {
      status: error.response?.status,
      code: errorData.code,
      message: errorData.error,
      details: errorData.details
    });
    
    // Format the error message based on the API error response
    try {
      let errorMessage = errorData.error || 'Authentication failed';
      
      // If we have a common authentication error status code
      if (error.response?.status === 401) {
        errorMessage = 'Invalid email or password';
      } else if (error.response?.status === 403) {
        errorMessage = 'Access denied';
      } else if (error.response?.status === 429) {
        errorMessage = 'Too many attempts. Please try again later';
      }
      
      // Check for details/validation errors
      if (errorData.details) {
        try {
          // Handle nested validation errors in the format the server returns
          let detailMessages: string[] = [];
          
          // Check for password errors which might be deeply nested
          if (errorData.details.password) {
            const passwordErrors = getErrorMessages(errorData.details.password);
            passwordErrors.forEach((error: string) => {
              detailMessages.push(`Password: ${error}`);
            });
          }
          
          // Check for email errors
          if (errorData.details.email) {
            const emailErrors = getErrorMessages(errorData.details.email);
            emailErrors.forEach((error: string) => {
              detailMessages.push(`Email: ${error}`);
            });
          }
          
          // Check for other field errors
          Object.entries(errorData.details).forEach(([key, value]) => {
            if (key !== 'password' && key !== 'email' && key !== '_errors') {
              const fieldErrors = getErrorMessages(value);
              fieldErrors.forEach((error: string) => {
                detailMessages.push(`${key}: ${error}`);
              });
            }
          });
          
          // Check for top-level errors
          if (errorData.details._errors) {
            const topErrors = getErrorMessages(errorData.details._errors);
            topErrors.forEach((error: string) => {
              detailMessages.push(error);
            });
          }
          
          // If we found specific error messages, use them
          if (detailMessages.length > 0) {
            throw new Error(`${errorMessage}: ${detailMessages.join('; ')}`);
          }
        } catch (parseError) {
          console.error('Error parsing validation details:', parseError);
        }
      }
      
      // If we got here, either there were no details or we couldn't parse them
      // Fall back to a simple error message
      throw new Error(errorMessage);
    } catch (formatError) {
      // If there's an error in our error formatting, use a simpler approach
      if (formatError instanceof Error) {
        throw formatError; // Re-throw if it's already a formatted Error
      } else {
        throw new Error('Authentication failed');
      }
    }
  } else if (error instanceof Error) {
    // Just re-throw if it's already an Error
    throw error;
  } else {
    // For any other type of error
    throw new Error('Authentication failed');
  }
};

/**
 * Helper function to extract error messages from various formats
 */
const getErrorMessages = (errorObj: any): string[] => {
  if (!errorObj) return [];
  
  // If it's an array of strings
  if (Array.isArray(errorObj) && typeof errorObj[0] === 'string') {
    return errorObj;
  }
  
  // If it's an object with _errors array
  if (errorObj._errors && Array.isArray(errorObj._errors)) {
    return errorObj._errors;
  }
  
  // If it's a string
  if (typeof errorObj === 'string') {
    return [errorObj];
  }
  
  // If it's an object with a message property
  if (typeof errorObj === 'object' && errorObj.message) {
    return [errorObj.message];
  }
  
  // If it's another type of object, stringify it
  if (typeof errorObj === 'object') {
    const errorStr = JSON.stringify(errorObj);
    return errorStr !== '{}' ? [errorStr] : [];
  }
  
  return [String(errorObj)];
}; 