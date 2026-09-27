import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { apiService } from './apiService';

/**
 * Service to handle complete app state reset
 */
class ResetService {
  private static instance: ResetService;

  private constructor() {}

  public static getInstance(): ResetService {
    if (!ResetService.instance) {
      ResetService.instance = new ResetService();
    }
    return ResetService.instance;
  }

  /**
   * Clear all data from AsyncStorage
   */
  public async clearAsyncStorage(): Promise<void> {
    try {
      console.log('Clearing all AsyncStorage data...');
      await AsyncStorage.clear();
      console.log('AsyncStorage cleared successfully');
    } catch (error) {
      console.error('Failed to clear AsyncStorage:', error);
      throw error;
    }
  }

  /**
   * Clear cache directories in the app
   */
  public async clearCacheDirectories(): Promise<void> {
    if (Platform.OS !== 'web') {
      try {
        console.log('Clearing cache directories...');
        
        // Clear the cache directory
        const cacheDir = FileSystem.cacheDirectory;
        if (cacheDir) {
          const contents = await FileSystem.readDirectoryAsync(cacheDir);
          
          // Delete each item in the cache directory
          for (const item of contents) {
            try {
              await FileSystem.deleteAsync(`${cacheDir}${item}`);
            } catch (e) {
              console.warn(`Could not delete cache item ${item}:`, e);
            }
          }
        }
        
        console.log('Cache directories cleared successfully');
      } catch (error) {
        console.error('Failed to clear cache directories:', error);
        // Don't throw, continue with other reset operations
      }
    }
  }

  /**
   * Clear API service cache
   */
  public clearApiCache(): void {
    try {
      console.log('Clearing API service cache...');
      apiService.clearCache();
      console.log('API cache cleared successfully');
    } catch (error) {
      console.error('Failed to clear API cache:', error);
      // Don't throw, continue with other reset operations
    }
  }

  /**
   * Clear app data and reload the app
   */
  public async resetAppCompletely(): Promise<void> {
    try {
      console.log('Starting complete app reset...');
      
      // Clear all storage
      await this.clearAsyncStorage();
      await this.clearCacheDirectories();
      this.clearApiCache();
      
      console.log('All storage cleared, reloading app...');
      
      // Reload the app
      if (Platform.OS !== 'web') {
        // Use React Native's DevSettings if available (dev mode)
        try {
          const DevSettings = require('react-native').DevSettings;
          if (DevSettings && DevSettings.reload) {
            DevSettings.reload();
          }
        } catch (e) {
          console.warn('DevSettings not available, cannot reload app automatically:', e);
          console.log('Please manually restart the app to complete the reset');
        }
      } else {
        // Web fallback
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to reset app completely:', error);
      throw error;
    }
  }
}

export const resetService = ResetService.getInstance(); 