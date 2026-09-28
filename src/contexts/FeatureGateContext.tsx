/**
 * FeatureGateContext - Centralized Feature Availability
 * 
 * Provides feature flags based on user subscription and selected model
 * Makes it easy to gate features behind subscription tiers or specific models
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { VOICE_MODELS, V3_ONLY_LANGUAGES, resolveModelId } from '../utils/voiceModels';

interface FeatureGateContextType {
  // Subscription-based features
  canUseElevenV3: boolean;
  isPremiumUser: boolean;
  userPlan: string | null;
  
  // Model-based features
  isV3AlphaModel: boolean;
  canUseEmotionalTags: boolean;
  canUseV3Languages: boolean;
  
  // Voice access features (CONSOLIDATED)
  canAccessPremiumVoices: boolean;
  
  // Language access features
  requiresPremiumForLanguage: (langCode: string) => boolean;
  canSelectLanguage: (langCode: string) => boolean;
  
  // Helper functions
  requiresModelSwitch: (feature: 'emotionalTags' | 'v3Languages') => boolean;
  requiresPremiumPlan: (feature: string) => boolean;
  canPreviewVoice: (isPremiumVoice: boolean) => boolean;
  canSelectVoice: (isPremiumVoice: boolean) => boolean;
}

const FeatureGateContext = createContext<FeatureGateContextType | undefined>(undefined);

interface FeatureGateProviderProps {
  children: ReactNode;
  userPlan?: string | null;
  selectedModel?: string | null;
}

// Premium plan IDs (must match backend)
const PREMIUM_PLANS = ['INTENSIVE', 'DAILY_COMPANION', 'intensive', 'daily-companion', 'daily_companion'];

export const FeatureGateProvider: React.FC<FeatureGateProviderProps> = ({
  children,
  userPlan,
  selectedModel
}) => {
  const value = useMemo(() => {
    // Normalize plan ID for comparison
    const normalizedPlan = userPlan?.toLowerCase() || '';
    
    // Check if user has premium subscription
    const isPremiumUser = PREMIUM_PLANS.some(p => p.toLowerCase() === normalizedPlan);
    
    // Check if current model is v3
    const isV3AlphaModel = resolveModelId(selectedModel) === VOICE_MODELS.ELEVEN_LABS_PREMIUM;
    
    // Feature flags
    const canUseElevenV3 = isPremiumUser;
    const canUseEmotionalTags = true; // Both v4 Turbo (default) and v3 perform audio tags
    const canUseV3Languages = isV3AlphaModel; // Model-gated only (future languages)
    
    // Voice access - Premium voices require INTENSIVE or DAILY_COMPANION plan
    const canAccessPremiumVoices = isPremiumUser;
    
    // Helper function to check if feature requires model switch
    const requiresModelSwitch = (feature: 'emotionalTags' | 'v3Languages'): boolean => {
      if (feature === 'v3Languages') {
        return !isV3AlphaModel;
      }
      return false;
    };
    
    // Helper function to check if feature requires premium plan
    const requiresPremiumPlan = (feature: string): boolean => {
      const premiumFeatures = ['elevenV3', 'premiumVoices'];
      return premiumFeatures.includes(feature) && !isPremiumUser;
    };
    
    // Voice access helper functions
    const canPreviewVoice = (isPremiumVoice: boolean): boolean => {
      if (isPremiumVoice) {
        return canAccessPremiumVoices;
      }
      return true; // Basic voices can always be previewed
    };
    
    const canSelectVoice = (isPremiumVoice: boolean): boolean => {
      if (isPremiumVoice) {
        return canAccessPremiumVoices;
      }
      return true; // Basic voices can always be selected
    };
    
    // Language access helper functions
    const requiresPremiumForLanguage = (langCode: string): boolean => {
      return V3_ONLY_LANGUAGES.includes(langCode) && !isPremiumUser;
    };
    
    const canSelectLanguage = (langCode: string): boolean => {
      if (V3_ONLY_LANGUAGES.includes(langCode)) {
        return isPremiumUser;
      }
      return true; // Standard languages can always be selected
    };
    
    // Debug logging
    console.log('[FeatureGate] Configuration:', {
      userPlan: userPlan || 'none',
      selectedModel: selectedModel || 'none',
      isPremiumUser,
      isV3AlphaModel,
      canUseElevenV3,
      canUseEmotionalTags,
      canUseV3Languages,
      canAccessPremiumVoices
    });
    
    return {
      canUseElevenV3,
      isPremiumUser,
      userPlan: userPlan || null,
      isV3AlphaModel,
      canUseEmotionalTags,
      canUseV3Languages,
      canAccessPremiumVoices,
      requiresPremiumForLanguage,
      canSelectLanguage,
      requiresModelSwitch,
      requiresPremiumPlan,
      canPreviewVoice,
      canSelectVoice
    };
  }, [userPlan, selectedModel]);
  
  return (
    <FeatureGateContext.Provider value={value}>
      {children}
    </FeatureGateContext.Provider>
  );
};

// Hook to use feature gates
export const useFeatureGate = (): FeatureGateContextType => {
  const context = useContext(FeatureGateContext);
  if (context === undefined) {
    throw new Error('useFeatureGate must be used within a FeatureGateProvider');
  }
  return context;
};

