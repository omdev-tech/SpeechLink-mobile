// Plan configuration for subscription tiers and feature access
export interface PlanConfig {
  id: string;
  name: string;
  price: number;
  creditLimit: number;
  displayCredits: string;
  voiceAccess: 'basic' | 'premium';
  canAccessPremiumVoices: boolean;
}

export const PLAN_CONFIG = {
  TRIAL: {
    id: 'trial',
    name: 'Trial',
    price: 0,
    creditLimit: 100,
    displayCredits: '100',
    voiceAccess: 'basic' as const,
    canAccessPremiumVoices: false,
  },
  FREE: {
    id: 'free',
    name: 'Trial',
    price: 0,
    creditLimit: 100,
    displayCredits: '100',
    voiceAccess: 'basic' as const,
    canAccessPremiumVoices: false,
  },
  OCCASIONAL: {
    id: 'occasional',
    name: 'Occasional',
    price: 4,
    creditLimit: 50000,
    displayCredits: '50K',
    voiceAccess: 'basic' as const,
    canAccessPremiumVoices: false,
  },
  PREMIUM: {
    id: 'occasional', // API maps PREMIUM to Occasional
    name: 'Occasional',
    price: 4,
    creditLimit: 50000,
    displayCredits: '50K',
    voiceAccess: 'basic' as const,
    canAccessPremiumVoices: false,
  },
  REGULAR: {
    id: 'regular',
    name: 'Regular',
    price: 15,
    creditLimit: 200000,
    displayCredits: '200K',
    voiceAccess: 'basic' as const,
    canAccessPremiumVoices: false,
  },
  INTENSIVE: {
    id: 'intensive',
    name: 'Intensive',
    price: 30,
    creditLimit: 500000,
    displayCredits: '500K',
    voiceAccess: 'premium' as const,
    canAccessPremiumVoices: true,
  },
  DAILY_COMPANION: {
    id: 'daily-companion',
    name: 'Daily Companion',
    price: 100,
    creditLimit: 3000000,
    displayCredits: '3M',
    voiceAccess: 'premium' as const,
    canAccessPremiumVoices: true,
  },
} as const;

// Helper to get plan configuration by tier
export const getPlanConfig = (tier: string | undefined): PlanConfig => {
  if (!tier) return PLAN_CONFIG.TRIAL;
  
  // Handle API tier mapping
  const normalizedTier = tier.toUpperCase();
  if (normalizedTier === 'DAILY_COMPANION' || normalizedTier === 'DAILY-COMPANION') {
    return PLAN_CONFIG.DAILY_COMPANION;
  }
  
  return PLAN_CONFIG[normalizedTier as keyof typeof PLAN_CONFIG] || PLAN_CONFIG.TRIAL;
};

// Helper to check subscription tiers
export const isTier = (currentTier: string | undefined, tierToCheck: string): boolean => {
  const currentPlan = getPlanConfig(currentTier);
  return currentPlan.name === tierToCheck;
};

// Helper to format credit numbers for display
export const formatCredits = (credits: number): string => {
  if (credits >= 1000000) {
    return `${(credits / 1000000).toFixed(0)}M`;
  }
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(0)}K`;
  }
  return credits.toString();
};

// Voice access control helpers
export const canAccessPremiumVoices = (tier: string | undefined): boolean => {
  const plan = getPlanConfig(tier);
  return plan.canAccessPremiumVoices;
};

export const getVoiceAccessLevel = (tier: string | undefined): 'basic' | 'premium' => {
  const plan = getPlanConfig(tier);
  return plan.voiceAccess;
};

export const isVoiceAccessible = (voiceAccessLevel: 'basic' | 'premium' | undefined, userTier: string | undefined): boolean => {
  if (!voiceAccessLevel || voiceAccessLevel === 'basic') {
    return true; // Basic voices are always accessible
  }
  
  return canAccessPremiumVoices(userTier);
};

// Plan tier validation helpers
export const isPremiumPlan = (tier: string | undefined): boolean => {
  return canAccessPremiumVoices(tier);
};

export const isBasicPlan = (tier: string | undefined): boolean => {
  return !canAccessPremiumVoices(tier);
}; 