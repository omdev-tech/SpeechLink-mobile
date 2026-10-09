import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Linking } from 'react-native';

const STORAGE_KEYS = {
  APP_OPENS_COUNT: 'app_opens_count',
  RATING_PROMPTED: 'rating_prompted',
  FIRST_OPEN_DATE: 'first_open_date',
  RATING_DISMISSED_DATE: 'rating_dismissed_date',
  DISMISS_COUNT: 'rating_dismiss_count',
};

const APP_STORE_LINKS = {
  ios: 'https://apps.apple.com/app/id6821018127', // App Store Connect app "Speech Link: AAC Voice"
  android: 'market://details?id=com.naqued.speechlinkmobile', // Replace with your actual package name
  androidWeb: 'https://play.google.com/store/apps/details?id=com.naqued.speechlinkmobile',
};

/**
 * OPTIMAL RATING PROMPT CONFIGURATION FOR MEDICAL/AAC APP
 * 
 * Strategy:
 * - Wait for genuine usage (7 opens) to ensure users have formed a real opinion
 * - Give 3 days to try app in different real-world situations
 * - Show after 45 seconds of active use (not intrusive)
 * - If dismissed, wait 90 days before asking again (respectful)
 * - After 2 dismissals, stop asking (user has made their decision)
 * - For second attempt, require 15 total opens (shows continued value)
 * 
 * This balances capturing enthusiastic users while respecting those who decline.
 */
const RATING_CONFIG = {
  // First attempt - catch early enthusiasts who love the app
  FIRST_ATTEMPT: {
    MIN_APP_OPENS: 7,              // After 7 sessions, user has real experience
    MIN_DAYS_SINCE_INSTALL: 3,     // 3 days allows trying in various situations
    DELAY_SECONDS: 45,              // 45 seconds of active use before showing
  },
  
  // Second attempt - catch those who needed more time to decide
  SECOND_ATTEMPT: {
    MIN_APP_OPENS: 15,              // Need to show continued usage (7 + 8 more)
    MIN_DAYS_BETWEEN_PROMPTS: 90,   // Wait 3 months before asking again
  },
  
  // Maximum times to ask before giving up
  MAX_DISMISS_COUNT: 2,             // After 2 dismissals, never ask again
};

class AppRatingService {
  /**
   * Increment app opens count
   */
  async incrementAppOpens(): Promise<void> {
    try {
      const countStr = await AsyncStorage.getItem(STORAGE_KEYS.APP_OPENS_COUNT);
      const count = countStr ? parseInt(countStr, 10) : 0;
      await AsyncStorage.setItem(STORAGE_KEYS.APP_OPENS_COUNT, (count + 1).toString());

      // Set first open date if not set
      const firstOpenDate = await AsyncStorage.getItem(STORAGE_KEYS.FIRST_OPEN_DATE);
      if (!firstOpenDate) {
        await AsyncStorage.setItem(STORAGE_KEYS.FIRST_OPEN_DATE, new Date().toISOString());
      }
    } catch (error) {
      console.error('[AppRatingService] Error incrementing app opens:', error);
    }
  }

  /**
   * Check if the rating prompt should be shown
   */
  async shouldShowRatingPrompt(forceShow: boolean = false): Promise<boolean> {
    try {
      // If forceShow is true, bypass all checks
      if (forceShow) {
        return true;
      }

      // Check if already prompted and accepted/rated
      const ratingPrompted = await AsyncStorage.getItem(STORAGE_KEYS.RATING_PROMPTED);
      if (ratingPrompted === 'completed') {
        console.log('[AppRatingService] User already rated - never show again');
        return false;
      }

      // Check dismiss count - stop after max dismissals
      const dismissCountStr = await AsyncStorage.getItem(STORAGE_KEYS.DISMISS_COUNT);
      const dismissCount = dismissCountStr ? parseInt(dismissCountStr, 10) : 0;
      
      if (dismissCount >= RATING_CONFIG.MAX_DISMISS_COUNT) {
        console.log('[AppRatingService] User dismissed too many times - never show again');
        return false;
      }

      // Get current app opens
      const countStr = await AsyncStorage.getItem(STORAGE_KEYS.APP_OPENS_COUNT);
      const appOpens = countStr ? parseInt(countStr, 10) : 0;

      // Check days since first install
      const firstOpenDateStr = await AsyncStorage.getItem(STORAGE_KEYS.FIRST_OPEN_DATE);
      if (!firstOpenDateStr) {
        return false;
      }
      const firstOpenDate = new Date(firstOpenDateStr);
      const daysSinceInstall = this.getDaysDifference(firstOpenDate, new Date());

      // FIRST ATTEMPT - Early enthusiasts
      if (dismissCount === 0) {
        // Need minimum opens and days for first attempt
        if (appOpens < RATING_CONFIG.FIRST_ATTEMPT.MIN_APP_OPENS) {
          console.log(`[AppRatingService] Need ${RATING_CONFIG.FIRST_ATTEMPT.MIN_APP_OPENS} opens, have ${appOpens}`);
          return false;
        }
        if (daysSinceInstall < RATING_CONFIG.FIRST_ATTEMPT.MIN_DAYS_SINCE_INSTALL) {
          console.log(`[AppRatingService] Need ${RATING_CONFIG.FIRST_ATTEMPT.MIN_DAYS_SINCE_INSTALL} days, have ${daysSinceInstall}`);
          return false;
        }
        console.log('[AppRatingService] ✓ First attempt conditions met');
        return true;
      }

      // SECOND ATTEMPT (or later) - Users who needed more time
      if (dismissCount > 0) {
        // Check if enough time has passed since last dismissal
        const dismissedDateStr = await AsyncStorage.getItem(STORAGE_KEYS.RATING_DISMISSED_DATE);
        if (dismissedDateStr) {
          const dismissedDate = new Date(dismissedDateStr);
          const daysSinceDismissal = this.getDaysDifference(dismissedDate, new Date());
          if (daysSinceDismissal < RATING_CONFIG.SECOND_ATTEMPT.MIN_DAYS_BETWEEN_PROMPTS) {
            console.log(`[AppRatingService] Need to wait ${RATING_CONFIG.SECOND_ATTEMPT.MIN_DAYS_BETWEEN_PROMPTS} days since dismissal, only ${daysSinceDismissal} days passed`);
            return false;
          }
        }

        // Need MORE app opens for second attempt (shows continued value)
        if (appOpens < RATING_CONFIG.SECOND_ATTEMPT.MIN_APP_OPENS) {
          console.log(`[AppRatingService] Second attempt needs ${RATING_CONFIG.SECOND_ATTEMPT.MIN_APP_OPENS} opens, have ${appOpens}`);
          return false;
        }

        console.log('[AppRatingService] ✓ Second attempt conditions met');
        return true;
      }

      return false;
    } catch (error) {
      console.error('[AppRatingService] Error checking if should show rating prompt:', error);
      return false;
    }
  }

  /**
   * Mark rating prompt as dismissed
   * Increments dismiss count and records dismissal date
   */
  async markRatingDismissed(): Promise<void> {
    try {
      // Increment dismiss count
      const dismissCountStr = await AsyncStorage.getItem(STORAGE_KEYS.DISMISS_COUNT);
      const dismissCount = dismissCountStr ? parseInt(dismissCountStr, 10) : 0;
      const newDismissCount = dismissCount + 1;
      
      await AsyncStorage.setItem(STORAGE_KEYS.DISMISS_COUNT, newDismissCount.toString());
      await AsyncStorage.setItem(STORAGE_KEYS.RATING_DISMISSED_DATE, new Date().toISOString());
      
      console.log(`[AppRatingService] Rating dismissed (${newDismissCount}/${RATING_CONFIG.MAX_DISMISS_COUNT})`);
      
      if (newDismissCount >= RATING_CONFIG.MAX_DISMISS_COUNT) {
        console.log('[AppRatingService] Maximum dismissals reached - will never show again');
      }
    } catch (error) {
      console.error('[AppRatingService] Error marking rating dismissed:', error);
    }
  }

  /**
   * Mark rating as completed (user went to store)
   */
  async markRatingCompleted(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.RATING_PROMPTED, 'completed');
    } catch (error) {
      console.error('[AppRatingService] Error marking rating completed:', error);
    }
  }

  /**
   * Open the app store for rating
   */
  async openAppStore(): Promise<void> {
    try {
      const url = this.getStoreUrl();
      const supported = await Linking.canOpenURL(url);

      if (supported) {
        await Linking.openURL(url);
        await this.markRatingCompleted();
      } else {
        // Fallback to web URL for Android
        if (Platform.OS === 'android') {
          await Linking.openURL(APP_STORE_LINKS.androidWeb);
          await this.markRatingCompleted();
        } else {
          throw new Error('Cannot open store URL');
        }
      }
    } catch (error) {
      console.error('[AppRatingService] Error opening app store:', error);
      throw error;
    }
  }

  /**
   * Get the appropriate store URL based on platform
   */
  private getStoreUrl(): string {
    return Platform.OS === 'ios' ? APP_STORE_LINKS.ios : APP_STORE_LINKS.android;
  }

  /**
   * Calculate difference in days between two dates
   */
  private getDaysDifference(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Reset all rating data (for testing purposes)
   */
  async resetRatingData(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.APP_OPENS_COUNT);
      await AsyncStorage.removeItem(STORAGE_KEYS.RATING_PROMPTED);
      await AsyncStorage.removeItem(STORAGE_KEYS.FIRST_OPEN_DATE);
      await AsyncStorage.removeItem(STORAGE_KEYS.RATING_DISMISSED_DATE);
      await AsyncStorage.removeItem(STORAGE_KEYS.DISMISS_COUNT);
      console.log('[AppRatingService] Rating data reset successfully');
    } catch (error) {
      console.error('[AppRatingService] Error resetting rating data:', error);
    }
  }

  /**
   * Get current rating stats (for debugging)
   */
  async getRatingStats(): Promise<{
    appOpens: number;
    ratingPrompted: string | null;
    firstOpenDate: string | null;
    daysSinceInstall: number;
    dismissCount: number;
    daysSinceLastDismissal: number;
    willShowAgain: boolean;
  }> {
    try {
      const countStr = await AsyncStorage.getItem(STORAGE_KEYS.APP_OPENS_COUNT);
      const appOpens = countStr ? parseInt(countStr, 10) : 0;
      const ratingPrompted = await AsyncStorage.getItem(STORAGE_KEYS.RATING_PROMPTED);
      const firstOpenDate = await AsyncStorage.getItem(STORAGE_KEYS.FIRST_OPEN_DATE);
      const dismissCountStr = await AsyncStorage.getItem(STORAGE_KEYS.DISMISS_COUNT);
      const dismissCount = dismissCountStr ? parseInt(dismissCountStr, 10) : 0;
      
      let daysSinceInstall = 0;
      if (firstOpenDate) {
        daysSinceInstall = this.getDaysDifference(new Date(firstOpenDate), new Date());
      }

      let daysSinceLastDismissal = 0;
      const dismissedDateStr = await AsyncStorage.getItem(STORAGE_KEYS.RATING_DISMISSED_DATE);
      if (dismissedDateStr) {
        daysSinceLastDismissal = this.getDaysDifference(new Date(dismissedDateStr), new Date());
      }

      // Determine if will show again
      const willShowAgain = 
        ratingPrompted !== 'completed' && 
        dismissCount < RATING_CONFIG.MAX_DISMISS_COUNT;

      return {
        appOpens,
        ratingPrompted,
        firstOpenDate,
        daysSinceInstall,
        dismissCount,
        daysSinceLastDismissal,
        willShowAgain,
      };
    } catch (error) {
      console.error('[AppRatingService] Error getting rating stats:', error);
      return {
        appOpens: 0,
        ratingPrompted: null,
        firstOpenDate: null,
        daysSinceInstall: 0,
        dismissCount: 0,
        daysSinceLastDismissal: 0,
        willShowAgain: true,
      };
    }
  }

  /**
   * Get the delay in milliseconds before showing the rating prompt
   */
  getDisplayDelay(): number {
    return RATING_CONFIG.FIRST_ATTEMPT.DELAY_SECONDS * 1000;
  }
}

export default new AppRatingService();



