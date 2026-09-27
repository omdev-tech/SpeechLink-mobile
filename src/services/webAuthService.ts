import { API_CONFIG } from '../config/api';
import * as WebBrowser from 'expo-web-browser';
import { getToken } from './secureStorage';

/**
 * Service for opening web pages with automatic authentication
 * Generates a temporary token and opens the browser with auto-login
 */
class WebAuthService {
  private static instance: WebAuthService;
  
  private constructor() {}
  
  public static getInstance(): WebAuthService {
    if (!WebAuthService.instance) {
      WebAuthService.instance = new WebAuthService();
    }
    return WebAuthService.instance;
  }
  
  /**
   * Open a web page with automatic authentication
   * @param path The path to open (e.g., '/pricing', '/profile')
   * @returns Promise resolving when browser is closed
   */
  public async openAuthenticatedWebPage(path: string): Promise<void> {
    try {
      console.log(`Opening authenticated web page: ${path}`);
      
      // Get the user's auth token
      const authToken = await getToken();
      
      if (!authToken) {
        throw new Error('User not authenticated');
      }
      
      // Generate a temporary web auth token
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/mobile/generate-web-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate web authentication token');
      }
      
      const data = await response.json();
      
      if (!data.success || !data.token) {
        throw new Error('Invalid response from server');
      }
      
      // Construct the authenticated URL
      const webUrl = `${API_CONFIG.BASE_URL}/mobile-auth?token=${data.token}&redirect=${encodeURIComponent(path)}`;
      
      console.log(`Opening browser with authenticated URL`);
      
      // Open the browser
      const result = await WebBrowser.openBrowserAsync(webUrl, {
        // iOS options
        dismissButtonStyle: 'close',
        readerMode: false,
        // Android options
        showTitle: true,
        enableBarCollapsing: false,
        // Universal options
        toolbarColor: '#4A6FEA',
        controlsColor: '#FFFFFF',
      });
      
      console.log('Browser closed with result:', result.type);
      
    } catch (error) {
      console.error('Error opening authenticated web page:', error);
      throw error;
    }
  }
  
  /**
   * Shortcut methods for common pages
   */
  public async openProfile(): Promise<void> {
    return this.openAuthenticatedWebPage('/profile');
  }
  
  public async openSubscription(): Promise<void> {
    return this.openAuthenticatedWebPage('/pricing');
  }
  
  public async openPricing(): Promise<void> {
    return this.openAuthenticatedWebPage('/pricing');
  }
  
  public async openResources(lang: string = 'en'): Promise<void> {
    return this.openAuthenticatedWebPage(`/${lang}/resources`);
  }
}

export default WebAuthService.getInstance();



