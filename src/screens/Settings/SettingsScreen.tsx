import React, { useContext, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Platform,
  Linking,
  Modal,
  FlatList,
  TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Context
import { ThemeContext } from '../../contexts/ThemeContext';
import { AuthContext } from '../../contexts/AuthContext';
import { useTutorial } from '../../contexts/TutorialContext';

// Components
import { ScreenHeader } from '../../components/UI/ScreenHeader';
import { TutorialTarget } from '../../components/Tutorial/TutorialTarget';

// Components
import DeveloperSettings from '../../components/SettingsScreen/DeveloperSettings';

// Hooks
import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import { useTextToSpeech } from '../../hooks/useTextToSpeech';
import { useFeatureGate } from '../../contexts/FeatureGateContext';
import { VOICE_MODELS, requiresV3Model } from '../../utils/voiceModels';

// Language options with native names and flags
const LANGUAGE_OPTIONS = [
  { id: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { id: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { id: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { id: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { id: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { id: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { id: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { id: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { id: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { id: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { id: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { id: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { id: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { id: 'fil', name: 'Filipino', nativeName: 'Filipino', flag: '🇵🇭' },
  { id: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { id: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { id: 'bg', name: 'Bulgarian', nativeName: 'Български', flag: '🇧🇬' },
  { id: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  { id: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { id: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  { id: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  { id: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { id: 'hr', name: 'Croatian', nativeName: 'Hrvatski', flag: '🇭🇷' },
  { id: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { id: 'sk', name: 'Slovak', nativeName: 'Slovenčina', flag: '🇸🇰' },
  { id: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { id: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { id: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { id: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { id: 'urd', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' }
];

// Add apiService import at the top
import { apiService } from '../../services/apiService';
import { aacService } from '../../services/aacService';
import { AACPreferences } from '../../models/AAC';
import webAuthService from '../../services/webAuthService';
import LogoutEverywhereButton from '../../components/SettingsScreen/LogoutEverywhereButton';
import DeleteAccountButton from '../../components/SettingsScreen/DeleteAccountButton';
import { canShowPurchaseOptions } from '../../config/purchases';

const SettingsScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const { theme, toggleTheme } = useContext(ThemeContext);
  const { signOut } = useContext(AuthContext);
  const { startTutorial, currentStep, isActive: isTutorialActive } = useTutorial();
  
  // Ref for auto-scrolling during tutorial
  const scrollViewRef = React.useRef<ScrollView>(null);
  
  const { 
    userSettings, 
    isLoading,
    availableVoices,
    updateVoiceSettings,
    profileData,
    fetchProfileData,
    refreshSettings
  } = useVoiceSettings();

  const { 
    isAudioRoutingEnabled,
    toggleAudioRouting 
  } = useTextToSpeech();
  
  // Feature gating for premium languages
  const { canSelectLanguage, requiresPremiumForLanguage } = useFeatureGate();
  
  const isDarkMode = theme.background === themes.dark.background;
  const [isLanguageModalVisible, setLanguageModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDevSettings, setShowDevSettings] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  
  // AAC Preferences state
  const [aacPreferences, setAacPreferences] = useState<AACPreferences | null>(null);
  const [loadingAACPrefs, setLoadingAACPrefs] = useState(false);

  // Fetch profile data if needed
  useEffect(() => {
    if (!profileData) {
      fetchProfileData();
    }
  }, [profileData, fetchProfileData]);

  // Fetch AAC preferences
  useEffect(() => {
    const fetchAACPreferences = async () => {
      try {
        setLoadingAACPrefs(true);
        const prefs = await aacService.getPreferences();
        setAacPreferences(prefs);
      } catch (error) {
        console.error('Error fetching AAC preferences:', error);
      } finally {
        setLoadingAACPrefs(false);
      }
    };

    fetchAACPreferences();
  }, []);

  // Auto-scroll during tutorial
  useEffect(() => {
    if (isTutorialActive && currentStep && currentStep.targetScreen === 'Settings' && scrollViewRef.current) {
      // Map target IDs to approximate scroll positions (in pixels from top)
      // These values ensure the element is visible with some space around it
      const scrollPositions: Record<string, number> = {
        'settings-language': 0,        // At the top
        'settings-audio-output': 150,  // Audio section
        'settings-hide-defaults': 300, // AAC Settings section
        'settings-discord': 480,       // Integrations section
        'settings-subscription': 580,  // Account section
      };
      
      const targetId = currentStep.targetId;
      if (targetId && scrollPositions[targetId] !== undefined) {
        // Delay to allow UI to settle before scrolling
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            y: scrollPositions[targetId],
            animated: true,
          });
        }, 100);
      }
    }
  }, [isTutorialActive, currentStep]);

  // Find the currently selected voice
  // Handle both voiceId (from TypeScript interface) and selectedVoice (from API response)
  const selectedVoiceId = userSettings?.voiceSettings?.voiceId || 
    (userSettings?.voiceSettings as any)?.selectedVoice;
  
  // First check if the voice exists in profile data's voiceSettings
  let currentVoice = null;
  
  // Use the new profileData.voiceSettings.selectedVoice if available
  if (profileData?.voiceSettings?.selectedVoice) {
    currentVoice = {
      id: profileData.voiceSettings.selectedVoice.id,
      name: profileData.voiceSettings.selectedVoice.name || 'Unknown Voice',
      provider: profileData.voiceSettings.selectedVoice.provider
    };
  }
  // Otherwise check if voice is in favoriteVoices
  else if (profileData?.favoriteVoices) {
    const profileVoice = profileData.favoriteVoices.find(
      (voice: any) => voice.voiceId === selectedVoiceId
    );
    
    if (profileVoice) {
      currentVoice = {
        id: profileVoice.voiceId,
        name: profileVoice.name,
        provider: profileVoice.provider,
      };
    }
  }
  
  // If not found in profile, try to find in availableVoices
  if (!currentVoice && availableVoices && availableVoices.length > 0) {
    currentVoice = availableVoices.find(voice => voice.id === selectedVoiceId);
  }
  
  // If still not found, try to find in the voices array from the API response
  if (!currentVoice && (userSettings?.voiceSettings as any)?.voices) {
    const apiVoices = (userSettings?.voiceSettings as any)?.voices || [];
    currentVoice = apiVoices.find((voice: any) => voice.id === selectedVoiceId);
  }

  // Additional check: If using ELEVENLABS but still not found, try searching in API with direct lookup
  useEffect(() => {
    const lookupMissingVoice = async () => {
      if (selectedVoiceId && 
          !currentVoice && 
          userSettings?.voiceSettings?.provider === 'ELEVENLABS') {
        try {
          // Try to fetch voice details directly from API
          console.log('Attempting to fetch missing voice details for:', selectedVoiceId);
          const voiceDetails = await apiService.get<{voices: any[]}>(`/api/shared-voices?voice_id=${selectedVoiceId}`);
          if (voiceDetails?.voices && voiceDetails.voices.length > 0) {
            // We found the voice, force an update
            console.log('Found missing voice details:', voiceDetails.voices[0]);
            refreshSettings();
          }
        } catch (error) {
          console.error('Failed to lookup missing voice:', error);
        }
      }
    };
    
    lookupMissingVoice();
  }, [selectedVoiceId, currentVoice, userSettings?.voiceSettings?.provider, refreshSettings]);

  const styles = makeStyles(theme);

  const filteredLanguages = searchQuery 
    ? LANGUAGE_OPTIONS.filter(lang => 
        lang.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        lang.nativeName.toLowerCase().includes(searchQuery.toLowerCase()))
    : LANGUAGE_OPTIONS;

  const handleChangeLanguage = async (languageCode: string) => {
    try {
      // Check if language can be selected
      if (!canSelectLanguage(languageCode)) {
        Alert.alert(
          t('modelSelection.languageRequiresPremium') || 'Premium Required',
          t('emotionalTags.premiumRequired') || 'This language requires INTENSIVE or DAILY_COMPANION plan'
        );
        return;
      }
      
      console.log('[SettingsScreen] Changing language to:', languageCode);
      console.log('[SettingsScreen] Current language before change:', i18n.language);
      
      await i18n.changeLanguage(languageCode);
      await AsyncStorage.setItem('userLanguage', languageCode);
      
      // Verify the language was stored correctly
      const storedLanguage = await AsyncStorage.getItem('userLanguage');
      console.log('[SettingsScreen] Stored language in AsyncStorage:', storedLanguage);
      console.log('[SettingsScreen] Current language after change:', i18n.language);
      
      // Force a refresh of the i18n instance
      if (i18n.language !== languageCode) {
        console.log('[SettingsScreen] Warning: i18n.language not updated as expected!');
        // Try to force the change again
        setTimeout(() => {
          i18n.changeLanguage(languageCode);
        }, 100);
      }
      
      // Check if this language requires v3 model
      if (requiresV3Model(languageCode)) {
        console.log('[SettingsScreen] Language requires v3 model, switching...');
        try {
          await updateVoiceSettings({ modelId: VOICE_MODELS.ELEVEN_LABS_PREMIUM } as any);
          
          // Show toast notification
          const languageName = LANGUAGE_OPTIONS.find(l => l.id === languageCode)?.name || 'Urdu';
          if (Platform.OS === 'android') {
            const { ToastAndroid } = require('react-native');
            ToastAndroid.show(
              t('modelSelection.switchedForLanguage', { language: languageName }) || 
              `Switched to Premium Model (v3) for ${languageName} language support`,
              ToastAndroid.LONG
            );
          } else {
            Alert.alert(
              t('general.success') || 'Success',
              t('modelSelection.switchedForLanguage', { language: languageName }) || 
              `Switched to Premium Model (v3) for ${languageName} language support`
            );
          }
        } catch (error) {
          console.error('[SettingsScreen] Failed to switch model:', error);
        }
      }
    } catch (error) {
      console.error('Failed to change language', error);
      Alert.alert(t('general.error.title'), 'Failed to change language');
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      t('settings.logout'),
      'Are you sure you want to log out?',
      [
        {
          text: t('general.cancel'),
          style: 'cancel',
        },
        {
          text: t('settings.logout'),
          onPress: signOut,
        },
      ]
    );
  };

  const handleToggleAutoSpeakSetting = async (value: boolean) => {
    if (!userSettings?.voiceSettings) return;
    
    try {
      await updateVoiceSettings({
        ...userSettings.voiceSettings,
        autoSpeakEnabled: value
      });
    } catch (err) {
      Alert.alert(t('general.error.title'), 'Failed to update auto-speak setting');
    }
  };

  const handleToggleAudioRouting = async (value: boolean) => {
    if (value) {
      // Show confirmation dialog when enabling
      Alert.alert(
        t('voice_settings.audio_routing.confirmation_title'),
        t('voice_settings.audio_routing.confirmation_message'),
        [
          {
            text: t('general.cancel'),
            style: 'cancel',
          },
          {
            text: t('general.enable'),
            onPress: async () => {
              const success = await toggleAudioRouting(true);
              if (!success) {
                Alert.alert(t('general.error.title'), t('voice_settings.audio_routing.enable_failed'));
              }
            },
          },
        ]
      );
    } else {
      // No confirmation needed when disabling
      const success = await toggleAudioRouting(false);
      if (!success) {
        Alert.alert(t('general.error.title'), t('voice_settings.audio_routing.disable_failed'));
      }
    }
  };

  const handleToggleHideDefaultSentences = async (value: boolean) => {
    try {
      setLoadingAACPrefs(true);
      const updatedPrefs = await aacService.updatePreferences({ 
        hideDefaultSentences: value 
      });
      setAacPreferences(updatedPrefs);
    } catch (error) {
      console.error('Error updating AAC preferences:', error);
      Alert.alert(t('general.error.title'), 'Failed to update AAC preference');
    } finally {
      setLoadingAACPrefs(false);
    }
  };

  const handleSubscriptionPress = async () => {
    try {
      // Open the dedicated pricing page for mobile users with automatic authentication
      await webAuthService.openAuthenticatedWebPage(`/${i18n.language}/pricing`);
    } catch (error) {
      console.error('Error opening subscription page:', error);
      Alert.alert(
        t('general.error.title'), 
        'Failed to open subscription page. Please try again.'
      );
    }
  };

  const handleResourcesPress = async () => {
    try {
      // Open the resources page with automatic authentication
      await webAuthService.openAuthenticatedWebPage(`/${i18n.language}/resources`);
    } catch (error) {
      console.error('Error opening resources page:', error);
      Alert.alert(
        t('general.error.title'), 
        t('settings.resourcesError') || 'Failed to open resources page. Please try again.'
      );
    }
  };

  const handleReplayTutorial = async () => {
    try {
      // Reset tutorial status and start it
      const { tutorialService } = await import('../../services/tutorialService');
      await tutorialService.resetTutorial();
      startTutorial();
    } catch (error) {
      console.error('Error replaying tutorial:', error);
      Alert.alert(
        t('general.error.title'),
        'Failed to start tutorial. Please try again.'
      );
    }
  };

  // Add navigation to the Voice Collection screen
  const handleVoiceSelectionPress = () => {
    navigation.navigate('VoiceCollection' as never);
  };

  // Add debug logging for voice selection
  useEffect(() => {
    console.log("Voice Settings Debug:");
    console.log("Selected voice ID:", selectedVoiceId);
    console.log("Current voice found:", currentVoice ? {
      id: currentVoice.id,
      name: currentVoice.name,
      provider: currentVoice.provider
    } : "No voice found");
    console.log("Available voices count:", availableVoices.length);
    console.log("Profile favorite voices:", profileData?.favoriteVoices ? 
      profileData.favoriteVoices.length : "Not available");
    console.log("API voices:", (userSettings?.voiceSettings as any)?.voices ? 
      (userSettings?.voiceSettings as any)?.voices.length : "Not available");
  }, [selectedVoiceId, currentVoice, availableVoices, userSettings, profileData]);

  const renderSettingItem = (
    icon: string,
    title: string,
    value?: React.ReactNode,
    onPress?: () => void,
    showArrow: boolean = true
  ) => (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingLeftContent}>
        <View style={styles.settingIconContainer}>
          <Ionicons name={icon as any} size={22} color={theme.primary} />
        </View>
        <Text style={styles.settingTitle}>{title}</Text>
      </View>
      <View style={styles.settingRightContent}>
        {value}
        {showArrow && onPress && (
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.text + '80'}
            style={styles.settingArrow}
          />
        )}
      </View>
    </TouchableOpacity>
  );

  const renderLanguageModal = () => (
    <Modal
      visible={isLanguageModalVisible}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setLanguageModalVisible(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setLanguageModalVisible(false)}>
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{t('language.select')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder={t('general.search')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={theme.text + '50'}
        />
        <FlatList
          data={filteredLanguages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isLocked = !canSelectLanguage(item.id);
            const isSelected = i18n.language === item.id;
            const requiresPremiumModel = requiresV3Model(item.id);
            
            return (
              <TouchableOpacity
                style={[
                  styles.languageOption,
                  isLocked && styles.languageOptionLocked
                ]}
                onPress={() => {
                  if (isLocked) {
                    Alert.alert(
                      t('modelSelection.languageRequiresPremium') || 'Premium Required',
                      t('emotionalTags.premiumRequired') || 'This language requires INTENSIVE or DAILY_COMPANION plan'
                    );
                    return;
                  }
                  
                  handleChangeLanguage(item.id);
                  setLanguageModalVisible(false);
                  setSearchQuery('');
                }}
                disabled={isLocked && !isSelected}
              >
                <View style={styles.languageRow}>
                  <Text style={styles.languageFlag}>{item.flag}</Text>
                  <View style={styles.languageTextContainer}>
                    <Text style={[
                      styles.languageText,
                      isLocked && styles.languageTextLocked
                    ]}>
                      {item.nativeName}
                    </Text>
                    <Text style={[
                      styles.languageSubtext,
                      isLocked && styles.languageTextLocked
                    ]}>
                      {t(`languages.${item.id}`)}
                    </Text>
                    {requiresPremiumModel && !isLocked && (
                      <View style={styles.premiumModelBadge}>
                        <Text style={styles.premiumModelBadgeText}>
                          🎭 v3
                        </Text>
                      </View>
                    )}
                  </View>
                  {isLocked && (
                    <Text style={styles.lockIcon}>🔒</Text>
                  )}
                </View>
                {isSelected && !isLocked && (
                  <Ionicons name="checkmark" size={22} color={theme.primary} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );

  // Render voice selection with better fallback
  const renderVoiceSelection = () => {
    if (isLoading) return <Text style={styles.settingValueText}>Loading...</Text>;
    
    if (currentVoice) {
      return (
        <View style={styles.voiceValueContainer}>
          <Text style={styles.settingValueText}>
            {currentVoice.name}
          </Text>
          <View style={styles.voiceProviderBadge}>
            <Text style={styles.voiceProviderText}>
              {currentVoice.provider}
            </Text>
          </View>
        </View>
      );
    }
    
    if (selectedVoiceId) {
      return (
        <View style={styles.voiceValueContainer}>
          <Text style={styles.settingValueText}>
            {t('voice.settings.unknownVoice', 'Unknown Voice')}
          </Text>
          <View style={styles.voiceProviderBadge}>
            <Text style={styles.voiceProviderText}>
              {(userSettings?.voiceSettings as any)?.provider || 'UNKNOWN'}
            </Text>
          </View>
        </View>
      );
    }
    
    return (
      <Text style={[styles.settingValueText, {color: theme.error + '80'}]}>
        {t('voice.settings.noVoiceSelected', 'Not selected')}
      </Text>
    );
  };

  // Add this section to display the Discord settings option
  const renderIntegrationSettings = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('settings.integrations')}</Text>
      
      <TutorialTarget id="settings-discord">
        {renderSettingItem(
          'logo-discord',
          t('settings.discordSettings'),
          null,
          () => navigation.navigate('DiscordSettings' as never)
        )}
      </TutorialTarget>
      
      {/* {renderSettingItem(
        'options-outline',
        t('settings.audioRouting'),
        <Switch
          value={isAudioRoutingEnabled}
          onValueChange={handleToggleAudioRouting}
        />,
        undefined,
        false
      )} */}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('settings.title')} />

      <ScrollView 
        ref={scrollViewRef} 
        style={styles.scrollView}
        scrollEnabled={!(isTutorialActive && currentStep?.targetScreen === 'Settings')}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.theme')}</Text>
          {renderSettingItem(
            'moon-outline',
            t('settings.darkMode'),
            <Switch
              value={isDarkMode}
              onValueChange={toggleTheme}
              trackColor={{ false: theme.border, true: theme.primary + '80' }}
              thumbColor={isDarkMode ? theme.primary : '#f4f3f4'}
              ios_backgroundColor={theme.border}
            />,
            undefined,
            false
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
          <TutorialTarget id="settings-language">
            {renderSettingItem(
              'language-outline',
              t('language.select'),
              <Text style={styles.settingValueText}>
                {LANGUAGE_OPTIONS.find(l => l.id === i18n.language)?.nativeName || 'English'}
              </Text>,
              () => setLanguageModalVisible(true)
            )}
          </TutorialTarget>
          {renderSettingItem(
            'people-outline',
            t('settings.resources') || 'Resources',
            undefined,
            handleResourcesPress
          )}
          {renderLanguageModal()}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.audio')}</Text>
          <TutorialTarget id="settings-audio-output">
            {renderSettingItem(
              'volume-high-outline',
              t('audioOutput.title') || 'Audio Output',
              undefined,
              () => navigation.navigate('AudioOutputSettings' as never)
            )}
          </TutorialTarget>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AAC Settings</Text>
          <TutorialTarget id="settings-hide-defaults">
            {renderSettingItem(
              'eye-off-outline',
              t('settings.hideDefaultSentences'),
              <Switch
                value={aacPreferences?.hideDefaultSentences || false}
                onValueChange={handleToggleHideDefaultSentences}
                trackColor={{ false: theme.border, true: theme.primary + '80' }}
                thumbColor={aacPreferences?.hideDefaultSentences ? theme.primary : '#f4f3f4'}
                ios_backgroundColor={theme.border}
                disabled={loadingAACPrefs}
              />,
              undefined,
              false
            )}
          </TutorialTarget>
          <Text style={styles.settingDescription}>
            {t('settings.hideDefaultSentencesDesc')}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
          {renderSettingItem(
            'person-outline',
            t('profile.title'),
            undefined,
            () => navigation.navigate('Profile' as never)
          )}
          {canShowPurchaseOptions() && (
            <TutorialTarget id="settings-subscription">
              {renderSettingItem(
                'card-outline',
                t('profile.subscription'),
                undefined,
                handleSubscriptionPress
              )}
            </TutorialTarget>
          )}
        </View>

        {renderIntegrationSettings()}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.help')}</Text>
          {renderSettingItem(
            'help-circle-outline',
            t('settings.replayTutorial') || 'Replay Tutorial',
            undefined,
            handleReplayTutorial
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.about')}</Text>
          {renderSettingItem(
            'information-circle-outline',
            t('settings.about'),
            undefined,
            () => navigation.navigate('About' as never)
          )}
          {renderSettingItem(
            'shield-checkmark-outline',
            t('settings.privacy'),
            undefined,
            () => Linking.openURL(`${process.env.APP_DOMAIN || 'https://speech-aac.link'}/${i18n.language}/privacy-policy`)
          )}
          {renderSettingItem(
            'document-text-outline',
            t('settings.terms'),
            undefined,
            () => Linking.openURL(`${process.env.APP_DOMAIN || 'https://speech-aac.link'}/${i18n.language}/terms-of-service`)
          )}
        </View>
        
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#FFFFFF" />
          <Text style={styles.logoutButtonText}>{t('settings.logout')}</Text>
        </TouchableOpacity>

        <LogoutEverywhereButton />

        <DeleteAccountButton />

        <TouchableOpacity 
          style={styles.bugReportButton} 
          onPress={() => Linking.openURL('mailto:pollet.dam@gmail.com?subject=Bug Report - Speech Link')}
        >
          <Ionicons name="bug-outline" size={20} color={theme.text} />
          <Text style={styles.bugReportButtonText}>{t('settings.reportBug') || 'Report a Bug'}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.featureRequestButton} 
          onPress={() => Linking.openURL('mailto:pollet.dam@gmail.com?subject=Feature Request - Speech Link')}
        >
          <Ionicons name="bulb-outline" size={20} color={theme.text} />
          <Text style={styles.featureRequestButtonText}>{t('settings.requestFeature') || 'Request a Feature'}</Text>
        </TouchableOpacity>

        <View style={styles.versionContainer}>
          <TouchableOpacity 
            onPress={() => {
              setTapCount(prev => {
                const newCount = prev + 1;
                if (newCount >= 7) {
                  setShowDevSettings(true);
                  return 0;
                }
                return newCount;
              });
            }}
          >
            <Text style={styles.versionText}>Version 2.0</Text>
          </TouchableOpacity>
        </View>

        {showDevSettings && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Developer Settings</Text>
            <DeveloperSettings />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// Copy of themes from ThemeContext to avoid circular dependency
const themes = {
  light: {
    background: '#FFFFFF',
  },
  dark: {
    background: '#121212',
  },
};

const makeStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
    marginVertical: 10,
  },
  settingDescription: {
    fontSize: 14,
    color: theme.text + '80',
    marginTop: 8,
    marginLeft: 44,
    lineHeight: 20,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  settingLeftContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  settingTitle: {
    fontSize: 16,
    color: theme.text,
  },
  settingRightContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingValueText: {
    fontSize: 14,
    color: theme.text + '80',
    marginRight: 10,
  },
  settingArrow: {
    marginLeft: 5,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  languageOptionLocked: {
    opacity: 0.5,
  },
  languageText: {
    fontSize: 16,
    color: theme.text,
  },
  languageTextLocked: {
    color: theme.text + '66',
  },
  lockIcon: {
    fontSize: 16,
    marginLeft: 8,
  },
  warningContainer: {
    padding: 10,
    marginBottom: 10,
    backgroundColor: theme.error + '20',
    borderRadius: 8,
  },
  warningText: {
    fontSize: 14,
    color: theme.error,
  },
  premiumBadge: {
    backgroundColor: theme.primary,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
  },
  premiumBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  premiumModelBadge: {
    backgroundColor: theme.primary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  premiumModelBadgeText: {
    color: theme.primary,
    fontSize: 10,
    fontWeight: '600',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    marginBottom: 12,
    backgroundColor: theme.primary + '15',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.primary,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: theme.text + 'CC',
    marginLeft: 10,
    lineHeight: 18,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.error,
    marginHorizontal: 20,
    marginVertical: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  bugReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.card,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  bugReportButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  featureRequestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.card,
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  featureRequestButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  versionContainer: {
    alignItems: 'center',
    marginVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 30 : 10,
  },
  versionText: {
    fontSize: 14,
    color: theme.text + '50',
  },
  // Modal-specific styles
  modalContainer: {
    flex: 1,
    backgroundColor: theme.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  searchInput: {
    margin: 15,
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: theme.inputBackground || theme.background + '30',
    borderRadius: 8,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  languageFlag: {
    fontSize: 22,
    marginRight: 15,
  },
  languageTextContainer: {
    flexDirection: 'column',
  },
  languageSubtext: {
    fontSize: 14,
    color: theme.text + '80',
  },
  voiceValueContainer: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  voiceProviderBadge: {
    backgroundColor: theme.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 2,
  },
  voiceProviderText: {
    fontSize: 10,
    color: theme.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});

export default SettingsScreen; 