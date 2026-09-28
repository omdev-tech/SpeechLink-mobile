/**
 * Subscription Utility Functions for Mobile
 * 
 * Check user subscription levels and feature access
 */

import { VOICE_MODELS } from './voiceModels';

// Subscription plan IDs (must match backend)
const PREMIUM_PLANS = ['INTENSIVE', 'DAILY_COMPANION', 'intensive', 'daily-companion', 'daily_companion'];

export function isPremiumPlan(planId: string): boolean {
  if (!planId) {
    console.log('[SubscriptionUtils] No planId provided');
    return false;
  }
  
  const isPremium = PREMIUM_PLANS.some(p => p.toLowerCase() === planId.toLowerCase());
  console.log(`[SubscriptionUtils] Checking planId: "${planId}" -> isPremium: ${isPremium}`);
  
  return isPremium;
}

export function canUseElevenV3(planId: string): boolean {
  return isPremiumPlan(planId);
}

export function canUseEmotionalTags(_planId: string): boolean {
  return true; // Available on every plan since v4 Turbo is the default model
}

export function getAvailableModels(planId: string): string[] {
  const models: string[] = [VOICE_MODELS.ELEVEN_LABS];
  if (isPremiumPlan(planId)) {
    models.push(VOICE_MODELS.ELEVEN_LABS_PREMIUM);
  }
  return models;
}

export function getUpgradeMessage(feature: string): string {
  const messages: Record<string, string> = {
    'eleven_v3': 'Upgrade to INTENSIVE or DAILY_COMPANION plan to access the advanced emotional voice model',
    'emotional_tags': 'Upgrade to a premium plan to use emotional tags',
    'premium': 'This feature requires INTENSIVE or DAILY_COMPANION plan'
  };
  return messages[feature] || messages['premium'];
}



