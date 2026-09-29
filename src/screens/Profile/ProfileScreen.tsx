import React, { useState, useContext, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';

// Context
import { ThemeContext } from '../../contexts/ThemeContext';

// Services
import { profileService } from '../../services/profileService';
import { UserProfile } from '../../types/profile';
import webAuthService from '../../services/webAuthService';

// Plan configuration based on your specifications
const PLAN_CONFIG = {
  TRIAL: {
    id: 'trial',
    name: 'Trial',
    price: 0,
    creditLimit: 100,
    displayCredits: '100',
  },
  FREE: {
    id: 'free',
    name: 'Trial',
    price: 0,
    creditLimit: 100,
    displayCredits: '100',
  },
  OCCASIONAL: {
    id: 'occasional',
    name: 'Occasional',
    price: 3,
    creditLimit: 50000,
    displayCredits: '50K',
  },
  PREMIUM: {
    id: 'occasional', // API maps PREMIUM to Occasional
    name: 'Occasional',
    price: 3,
    creditLimit: 50000,
    displayCredits: '50K',
  },
  REGULAR: {
    id: 'regular',
    name: 'Regular',
    price: 8,
    creditLimit: 200000,
    displayCredits: '200K',
  },
  INTENSIVE: {
    id: 'intensive',
    name: 'Intensive',
    price: 15,
    creditLimit: 500000,
    displayCredits: '500K',
  },
  DAILY_COMPANION: {
    id: 'daily-companion',
    name: 'Daily Companion',
    price: 30,
    creditLimit: 3000000,
    displayCredits: '3M',
  },
} as const;

// Helper to get plan configuration by tier
const getPlanConfig = (tier: string | undefined) => {
  if (!tier) return PLAN_CONFIG.TRIAL;
  
  // Handle API tier mapping
  const normalizedTier = tier.toUpperCase();
  if (normalizedTier === 'DAILY_COMPANION' || normalizedTier === 'DAILY-COMPANION') {
    return PLAN_CONFIG.DAILY_COMPANION;
  }
  
  return PLAN_CONFIG[normalizedTier as keyof typeof PLAN_CONFIG] || PLAN_CONFIG.TRIAL;
};

// Helper to check subscription tiers
const isTier = (currentTier: string | undefined, tierToCheck: string): boolean => {
  const currentPlan = getPlanConfig(currentTier);
  return currentPlan.name === tierToCheck;
};

// Helper to format credit numbers for display
const formatCredits = (credits: number): string => {
  if (credits >= 1000000) {
    return `${(credits / 1000000).toFixed(0)}M`;
  }
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(0)}K`;
  }
  return credits.toString();
};

const ProfileScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const { theme } = useContext(ThemeContext);
  
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const styles = makeStyles(theme);

  useEffect(() => {
    loadProfile();
  }, []);

  // Add debug logging to check subscription data
  useEffect(() => {
    if (profile) {
      console.log('Profile loaded with subscription tier:', profile.subscription?.tier);
      console.log('Credits total from API:', profile.usage?.creditsTotal);
      console.log('Credits used:', profile.usage?.creditsUsed.total);
    }
  }, [profile]);

  const loadProfile = async () => {
    try {
      setIsLoading(true);
      const data = await profileService.getProfile();
      setProfile(data);
      setName(data.user.name || '');
      setEmail(data.user.email);
    } catch (error) {
      console.error('Error loading profile:', error);
      Alert.alert(t('general.error.title'), t('profile.loadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert(t('general.error.title'), t('profile.requiredFields'));
      return;
    }
    
    try {
      setIsLoading(true);
      await profileService.updateProfile({
        name: name.trim(),
        email: email.trim()
      });
      
      Alert.alert(t('general.success'), t('profile.updateSuccess'));
      setIsEditing(false);
      loadProfile(); // Reload profile to get latest data
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert(t('general.error.title'), t('profile.updateError'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleEditMode = () => {
    if (isEditing) {
      // Revert changes if canceling edit mode
      setName(profile?.user.name || '');
      setEmail(profile?.user.email || '');
    }
    setIsEditing(!isEditing);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  };
  // Add a function to handle external navigation
  const handleUpgradePress = async (plan: string) => {
    try {
      // Open the dedicated pricing page for mobile users with automatic authentication
      await webAuthService.openAuthenticatedWebPage(`/${i18n.language}/pricing`);
    } catch (error) {
      console.error('Error opening upgrade page:', error);
      Alert.alert(
        t('general.error.title'), 
        'Failed to open upgrade page. Please try again.'
      );
    }
  };

  // Add a function to get usage percentage and status
  const getUsageInfo = () => {
    if (!profile?.usage) return { percentage: 0, status: 'normal', planTotal: 0 };
    
    // Get the correct credit limit based on the current plan
    const currentPlan = getPlanConfig(profile.subscription?.tier);
    const planTotal = currentPlan.creditLimit;
    
    const used = profile.usage.creditsUsed.total;
    const percentage = Math.min(100, Math.round((used / planTotal) * 100));
    
    let status = 'normal';
    if (percentage >= 100) {
      status = 'exceeded';
    } else if (percentage >= 80) {
      status = 'warning';
    }
    
    return { percentage, status, planTotal };
  };

  // Helper to get a display name for the subscription tier
  const getSubscriptionDisplayName = (tier: string | undefined): string => {
    const plan = getPlanConfig(tier);
    return t(`profile.plans.${plan.id}`, plan.name);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('profile.loadError')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadProfile}>
            <Text style={styles.retryButtonText}>{t('general.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('profile.title')}</Text>
        <TouchableOpacity style={styles.editButton} onPress={toggleEditMode}>
          <Text style={styles.editButtonText}>
            {isEditing ? t('general.cancel') : t('general.edit')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView}>
        <View style={styles.profileHeader}>
          <Image
            source={{ 
              uri: profile.user.image || 
                `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4A6FEA&color=fff&size=200` 
            }}
            style={styles.profileImage}
          />
          {isEditing ? (
            <View style={styles.editNameContainer}>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder={t('profile.namePlaceholder')}
                placeholderTextColor={theme.text + '80'}
              />
            </View>
          ) : (
            <Text style={styles.profileName}>{name}</Text>
          )}
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('profile.email')}</Text>
            {isEditing ? (
              <TextInput
                style={styles.emailInput}
                value={email}
                onChangeText={setEmail}
                placeholder={t('profile.emailPlaceholder')}
                placeholderTextColor={theme.text + '80'}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            ) : (
              <Text style={styles.infoValue}>{email}</Text>
            )}
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('profile.subscription')}</Text>
            <View style={styles.subscriptionContainer}>
              <Text style={styles.infoValue}>
                {getSubscriptionDisplayName(profile.subscription?.tier)}
              </Text>
              {profile.subscription?.status === 'active' && (
                <View style={styles.subscriptionBadge}>
                  <Text style={styles.subscriptionBadgeText}>
                    {t('profile.active')}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {profile.subscription?.currentPeriodEnd && (
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>{t('profile.subscriptionExpiry')}</Text>
              <Text style={styles.infoValue}>
                {formatDate(profile.subscription.currentPeriodEnd)}
              </Text>
            </View>
          )}

          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('profile.memberSince')}</Text>
            <Text style={styles.infoValue}>
              {formatDate(profile.user.memberSince)}
            </Text>
          </View>

          {profile.usage && (
            <>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>{t('profile.creditsUsed')}</Text>
                <View style={styles.usageContainer}>
                  <View style={styles.usageHeader}>
                    <Text style={styles.infoValue}>
                      {profile.usage.creditsUsed.total} / {getUsageInfo().planTotal}
                    </Text>
                    <Text style={[
                      styles.usagePercentage, 
                      getUsageInfo().status === 'warning' && styles.usageWarning,
                      getUsageInfo().status === 'exceeded' && styles.usageExceeded,
                    ]}>
                      {getUsageInfo().percentage}%
                    </Text>
                  </View>
                  <View style={styles.usageBarContainer}>
                    <View 
                      style={[
                        styles.usageBar, 
                        { 
                          width: `${getUsageInfo().percentage}%`,
                          backgroundColor: 
                            getUsageInfo().status === 'exceeded' ? theme.error : 
                            getUsageInfo().status === 'warning' ? theme.warning : 
                            theme.primary
                        }
                      ]} 
                    />
                  </View>
                  {getUsageInfo().status === 'exceeded' && (
                    <Text style={styles.usageLimitMessage}>
                      {t('profile.limitExceeded', 'You have reached your monthly limit')}
                    </Text>
                  )}
                  {getUsageInfo().status === 'warning' && (
                    <Text style={styles.usageLimitMessage}>
                      {t('profile.limitWarning', 'You are approaching your monthly limit')}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>{t('profile.nextReset')}</Text>
                <Text style={styles.infoValue}>
                  {formatDate(profile.usage.nextResetDate)}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Subscription plans section */}
        <View style={styles.subscriptionSection}>
          <Text style={styles.sectionTitle}>{t('profile.plans.title', 'Subscription Plans')}</Text>
          
          {/* Trial Plan */}
          <View style={[
            styles.planCard, 
            (isTier(profile.subscription?.tier, 'Trial') || !profile.subscription?.tier) && styles.activePlanCard
          ]}>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>{t('profile.plans.trial', 'Trial')}</Text>
              {(isTier(profile.subscription?.tier, 'Trial') || !profile.subscription?.tier) && (
                <View style={styles.currentPlanBadge}>
                  <Text style={styles.currentPlanText}>{t('profile.currentPlan', 'Current')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.planPrice}>{t('profile.plans.free', 'Free')}</Text>
            <Text style={styles.planCredits}>{t('profile.plans.credits', '{{credits}} credits/month', { credits: PLAN_CONFIG.TRIAL.displayCredits })}</Text>
            <Text style={styles.planDescription}>{t('profile.plans.trialDesc', 'Basic access to try out the service')}</Text>
          </View>
          
          {/* Occasional Plan */}
          <View style={[
            styles.planCard, 
            isTier(profile.subscription?.tier, 'Occasional') && styles.activePlanCard
          ]}>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>{t('profile.plans.occasional', 'Occasional')}</Text>
              {isTier(profile.subscription?.tier, 'Occasional') && (
                <View style={styles.currentPlanBadge}>
                  <Text style={styles.currentPlanText}>{t('profile.currentPlan', 'Current')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.planPrice}>€{PLAN_CONFIG.OCCASIONAL.price}<Text style={styles.planPriceMonth}>/month</Text></Text>
            <Text style={styles.planCredits}>{t('profile.plans.credits', '{{credits}} credits/month', { credits: PLAN_CONFIG.OCCASIONAL.displayCredits })}</Text>
            <Text style={styles.planDescription}>{t('profile.plans.occasionalDesc', 'Perfect for occasional use')}</Text>
            
            {(!profile.subscription?.tier || isTier(profile.subscription?.tier, 'Trial')) && (
              <TouchableOpacity 
                style={styles.upgradePlanButton}
                onPress={() => handleUpgradePress('occasional')}
              >
                <Text style={styles.upgradePlanButtonText}>{t('profile.upgrade', 'Upgrade')}</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {/* Regular Plan */}
          <View style={[
            styles.planCard, 
            isTier(profile.subscription?.tier, 'Regular') && styles.activePlanCard
          ]}>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>{t('profile.plans.regular', 'Regular')}</Text>
              {isTier(profile.subscription?.tier, 'Regular') && (
                <View style={styles.currentPlanBadge}>
                  <Text style={styles.currentPlanText}>{t('profile.currentPlan', 'Current')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.planPrice}>€{PLAN_CONFIG.REGULAR.price}<Text style={styles.planPriceMonth}>/month</Text></Text>
            <Text style={styles.planCredits}>{t('profile.plans.credits', '{{credits}} credits/month', { credits: PLAN_CONFIG.REGULAR.displayCredits })}</Text>
            <Text style={styles.planDescription}>{t('profile.plans.regularDesc', 'Ideal for regular users')}</Text>
            
            {(!profile.subscription?.tier || 
              isTier(profile.subscription?.tier, 'Trial') || 
              isTier(profile.subscription?.tier, 'Occasional')) && (
              <TouchableOpacity 
                style={styles.upgradePlanButton}
                onPress={() => handleUpgradePress('regular')}
              >
                <Text style={styles.upgradePlanButtonText}>{t('profile.upgrade', 'Upgrade')}</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {/* Intensive Plan */}
          <View style={[
            styles.planCard, 
            isTier(profile.subscription?.tier, 'Intensive') && styles.activePlanCard
          ]}>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>{t('profile.plans.intensive', 'Intensive')}</Text>
              {isTier(profile.subscription?.tier, 'Intensive') && (
                <View style={styles.currentPlanBadge}>
                  <Text style={styles.currentPlanText}>{t('profile.currentPlan', 'Current')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.planPrice}>€{PLAN_CONFIG.INTENSIVE.price}<Text style={styles.planPriceMonth}>/month</Text></Text>
            <Text style={styles.planCredits}>{t('profile.plans.credits', '{{credits}} credits/month', { credits: PLAN_CONFIG.INTENSIVE.displayCredits })}</Text>
            <Text style={styles.planDescription}>{t('profile.plans.intensiveDesc', 'For intensive daily usage')}</Text>
            
            {(!profile.subscription?.tier || 
              isTier(profile.subscription?.tier, 'Trial') || 
              isTier(profile.subscription?.tier, 'Occasional') ||
              isTier(profile.subscription?.tier, 'Regular')) && (
              <TouchableOpacity 
                style={styles.upgradePlanButton}
                onPress={() => handleUpgradePress('intensive')}
              >
                <Text style={styles.upgradePlanButtonText}>{t('profile.upgrade', 'Upgrade')}</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {/* Daily Companion Plan */}
          <View style={[
            styles.planCard, 
            isTier(profile.subscription?.tier, 'Daily Companion') && styles.activePlanCard
          ]}>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>{t('profile.plans.dailyCompanion', 'Daily Companion')}</Text>
              {isTier(profile.subscription?.tier, 'Daily Companion') && (
                <View style={styles.currentPlanBadge}>
                  <Text style={styles.currentPlanText}>{t('profile.currentPlan', 'Current')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.planPrice}>€{PLAN_CONFIG.DAILY_COMPANION.price}<Text style={styles.planPriceMonth}>/month</Text></Text>
            <Text style={styles.planCredits}>{t('profile.plans.credits', '{{credits}} credits/month', { credits: PLAN_CONFIG.DAILY_COMPANION.displayCredits })}</Text>
            <Text style={styles.planDescription}>{t('profile.plans.dailyDesc', 'For professional or intensive usage')}</Text>
            
            {(!profile.subscription?.tier || 
              isTier(profile.subscription?.tier, 'Trial') || 
              isTier(profile.subscription?.tier, 'Occasional') ||
              isTier(profile.subscription?.tier, 'Regular') ||
              isTier(profile.subscription?.tier, 'Intensive')) && (
              <TouchableOpacity 
                style={styles.upgradePlanButton}
                onPress={() => handleUpgradePress('dailycompanion')}
              >
                <Text style={styles.upgradePlanButtonText}>{t('profile.upgrade', 'Upgrade')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isEditing && (
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>{t('general.save')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: theme.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: theme.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: theme.buttonText,
    fontSize: 16,
    fontWeight: '500',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.text,
  },
  editButton: {
    padding: 8,
  },
  editButtonText: {
    color: theme.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  profileHeader: {
    alignItems: 'center',
    marginVertical: 30,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 15,
    borderWidth: 3,
    borderColor: theme.primary,
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.text,
  },
  editNameContainer: {
    width: '70%',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    marginBottom: 5,
  },
  nameInput: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.text,
    textAlign: 'center',
    padding: 8,
  },
  infoSection: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  infoItem: {
    marginBottom: 20,
  },
  infoLabel: {
    fontSize: 14,
    color: theme.text + '80',
    marginBottom: 5,
  },
  infoValue: {
    fontSize: 18,
    color: theme.text,
  },
  emailInput: {
    fontSize: 18,
    color: theme.text,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    padding: 8,
    paddingLeft: 0,
  },
  subscriptionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subscriptionBadge: {
    backgroundColor: theme.success,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 10,
  },
  subscriptionBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: theme.primary,
    marginHorizontal: 20,
    marginBottom: 30,
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: theme.buttonText,
    fontSize: 16,
    fontWeight: '600',
  },
  usageContainer: {
    marginTop: 10,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  usagePercentage: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.primary,
  },
  usageWarning: {
    color: theme.warning || '#F59E0B',
  },
  usageExceeded: {
    color: theme.error,
  },
  usageBarContainer: {
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.border,
    overflow: 'hidden',
  },
  usageBar: {
    height: '100%',
    borderRadius: 5,
  },
  usageLimitMessage: {
    fontSize: 14,
    color: theme.error,
    marginTop: 5,
    fontStyle: 'italic',
  },
  subscriptionSection: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 20,
  },
  planCard: {
    backgroundColor: theme.card,
    padding: 20,
    borderRadius: 8,
    marginBottom: 20,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: theme.border,
  },
  activePlanCard: {
    borderWidth: 2,
    borderColor: theme.primary,
    backgroundColor: theme.primary + '10',
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  planName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  currentPlanBadge: {
    backgroundColor: theme.primary,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
  },
  currentPlanText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  planPrice: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 5,
  },
  planPriceMonth: {
    fontSize: 14,
    fontWeight: 'normal',
    color: theme.text + '80',
  },
  planCredits: {
    fontSize: 16,
    color: theme.text + '80',
    marginBottom: 10,
  },
  planDescription: {
    fontSize: 14,
    color: theme.text + '80',
    marginBottom: 10,
  },
  upgradePlanButton: {
    backgroundColor: theme.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  upgradePlanButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ProfileScreen; 