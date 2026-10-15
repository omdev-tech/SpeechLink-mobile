import React, { useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  Platform,
  Image,
  Linking,
  Modal,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import { useTextToSpeech } from '../../hooks/useTextToSpeech';
import { Voice } from '../../services/ttsService';
import { ThemeContext } from '../../contexts/ThemeContext';
import { useFeatureGate } from '../../contexts/FeatureGateContext';
import { VoiceSettings } from '../../services/voiceSettingsService';
import { Audio } from 'expo-av';
import { apiService } from '../../services/apiService';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../components/UI/ToastProvider';
import { ScreenHeader } from '../../components/UI/ScreenHeader';
import { PremiumBadge, UpgradePrompt } from '../../components/UI';

const VoiceSettingsScreen: React.FC = () => {
  const { theme } = useContext(ThemeContext);
  const { t } = useTranslation();
  const featureGate = useFeatureGate();
  const { 
    userSettings, 
    availableVoices, 
    isLoading, 
    loadingVoices, 
    error, 
    updateVoiceSettings,
    toggleFavoriteVoice,
    refreshSettings,
    profileData,
    fetchProfileData
  } = useVoiceSettings();
  
  const { 
    speak, 
    isLoading: isSpeaking, 
    previewVoice,
    isAudioRoutingEnabled,
    toggleAudioRouting 
  } = useTextToSpeech();
  
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [previewSound, setPreviewSound] = useState<Audio.Sound | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const styles = makeStyles(theme);

  // Clean up audio resources on unmount
  useEffect(() => {
    return () => {
      if (previewSound) {
        previewSound.unloadAsync().catch(err => {
          console.error('Error unloading sound on cleanup:', err);
        });
      }
    };
  }, [previewSound]);

  // Add a useEffect to fetch profile data if needed
  useEffect(() => {
    if (!profileData) {
      fetchProfileData();
    }
  }, [profileData, fetchProfileData]);

  // Filter voices based on current filters
  const filteredVoices = availableVoices.filter(voice => {
    if (showFavoritesOnly && userSettings?.favorites?.voices) {
      if (!userSettings.favorites.voices.includes(voice.id)) {
        return false;
      }
    }
    
    if (selectedProvider && voice.provider !== selectedProvider) {
      return false;
    }
    
    return true;
  });

  const handleVoiceSelect = async (voice: Voice) => {
    if (!userSettings?.voiceSettings) return;
    
    try {
      await updateVoiceSettings({
        ...userSettings.voiceSettings,
        provider: voice.provider,
        voiceId: voice.id
      });
      
      Alert.alert('Success', `Voice set to ${voice.name}`);
    } catch (err) {
      Alert.alert('Error', 'Failed to update voice selection');
    }
  };

  const handleToggleFavorite = async (voice: Voice) => {
    try {
      // Only consider the API favorites (from userSettings.favorites.voices)
      const isFavorite = !userSettings?.favorites?.voices?.includes(voice.id);
      
      // Gather all available metadata from the voice object
      const voiceDetails = {
        gender: voice.gender,
        accent: voice.accent,
        age: voice.age,
        use_case: voice.use_case,
        description: voice.description,
        publicOwnerId: voice.publicOwnerId || voice.public_owner_id,
        previewUrl: voice.previewUrl
      };
      
      await toggleFavoriteVoice(voice.id, isFavorite, voice.name, voiceDetails);
    } catch (err) {
      console.error('Error toggling favorite voice', err);
      Alert.alert('Error', 'Failed to update favorites');
    }
  };

  const handlePreviewVoice = async (voice: Voice) => {
    try {
      setIsPreviewLoading(true);
      setPreviewError(null);

      // Stop any existing preview
      if (previewSound) {
        await previewSound.unloadAsync();
        setPreviewSound(null);
      }

      // Use the previewVoice function from useTextToSpeech hook
      // Pass the publicOwnerId and voiceName for shared voices
      const sound = await previewVoice(
        voice.id, 
        voice.provider, 
        voice.public_owner_id || voice.publicOwnerId, 
        voice.name,
        voice.language || voice.languageCode
      );

      // Store the sound for cleanup later
      setPreviewSound(sound);
      setIsPreviewLoading(false);
    } catch (error) {
      console.error('Error previewing voice:', error);
      setPreviewError(error instanceof Error ? error.message : 'Failed to preview voice');
      setIsPreviewLoading(false);
      Alert.alert('Error', 'Failed to preview voice');
    }
  };

  const handleToggleAutoSpeakSetting = async (value: boolean) => {
    if (!userSettings?.voiceSettings) return;
    
    try {
      await updateVoiceSettings({
        ...userSettings.voiceSettings,
        autoSpeakEnabled: value
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to update auto-speak setting');
    }
  };

  const handleToggleEnhancementSetting = async (value: boolean) => {
    if (!userSettings?.voiceSettings) return;
    
    try {
      await updateVoiceSettings({
        ...userSettings.voiceSettings,
        enhancementEnabled: value
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to update enhancement setting');
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
                Alert.alert(t('general.error.title'), t('voice_settings.audio_routing.enable_failed', 'Failed to enable audio routing'));
              }
            },
          },
        ]
      );
    } else {
      // No confirmation needed when disabling
      const success = await toggleAudioRouting(false);
      if (!success) {
        Alert.alert(t('general.error.title'), t('voice_settings.audio_routing.disable_failed', 'Failed to disable audio routing'));
      }
    }
  };

  const isVoiceLoading = (voiceId: string) => {
    return (isSpeaking || isPreviewLoading) && userSettings?.voiceSettings?.voiceId === voiceId;
  };

  const renderVoiceItem = ({ item }: { item: Voice }) => {
    const isFavorite = userSettings?.favorites?.voices?.includes(item.id);
    const isSelected = userSettings?.voiceSettings?.voiceId === item.id;
    const isLoading = isVoiceLoading(item.id);
    
    // Voice access control - NOW USING FEATUREGATE
    const isPremiumVoice = item.isPremium || item.accessLevel === 'premium';
    const canPreview = featureGate.canPreviewVoice(isPremiumVoice);
    const canSelect = featureGate.canSelectVoice(isPremiumVoice);
    const requiresUpgrade = isPremiumVoice && !featureGate.canAccessPremiumVoices;

    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=4A6FEA&color=fff`;

    return (
      <TouchableOpacity 
        style={[
          styles.voiceItem,
          isSelected && styles.selectedVoiceItem,
          // Add disabled styling for inaccessible voices
          !canSelect && !isSelected && styles.voiceItemDisabled
        ]}
        onPress={() => {
          if (canSelect || isSelected) {
            handleVoiceSelect(item);
          }
        }}
        disabled={!canSelect && !isSelected}
      >
        <Image 
          source={{ uri: avatarUrl }} 
          style={[
            styles.voiceAvatar,
            // Dim avatar for inaccessible voices
            !canSelect && !isSelected && styles.avatarDisabled
          ]} 
        />
        <View style={styles.voiceInfo}>
          <View style={styles.voiceNameContainer}>
            <Text style={[
              styles.voiceName,
              isSelected && styles.selectedVoiceName,
              // Dim text for inaccessible voices
              !canSelect && !isSelected && styles.textDisabled
            ]}>
              {item.name}
            </Text>
            {isPremiumVoice && (
              <PremiumBadge 
                size="small" 
                style={styles.premiumBadge}
                iconOnly={true}
              />
            )}
            {isSelected && (
              <Ionicons name="checkmark-circle" size={16} color={theme.primary} style={styles.checkIcon} />
            )}
          </View>
          <Text style={[
            styles.voiceProvider,
            !canSelect && !isSelected && styles.textDisabled
          ]}>
            {item.provider} • {item.language || 'English'}
          </Text>
          
          {/* Show upgrade prompt for premium voices that require upgrade */}
          {requiresUpgrade && (
            <UpgradePrompt
              variant="inline"
              size="small"
              title={t('upgrade.premiumRequired', 'Premium Required')}
              message={t('upgrade.upgradeForVoice', 'Upgrade to access this premium voice.')}
              style={styles.upgradePromptInline}
            />
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.playButton,
            // Style play button based on access
            !canPreview && styles.playButtonDisabled
          ]}
          onPress={(e) => {
            e.stopPropagation();
            if (canPreview) {
              handlePreviewVoice(item);
            }
          }}
          disabled={isLoading || !canPreview}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons 
              name={canPreview ? "play" : "lock-closed"} 
              size={16} 
              color="#FFFFFF" 
            />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refreshSettings}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Voice Settings</Text>
          
          <View style={[styles.settingItem, { backgroundColor: theme.card }]}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Auto-speak in Text Mode</Text>
            <Switch
              value={userSettings?.voiceSettings?.autoSpeakEnabled ?? false}
              onValueChange={handleToggleAutoSpeakSetting}
              disabled={isLoading}
              trackColor={{ false: '#767577', true: theme.primary + '50' }}
              thumbColor={userSettings?.voiceSettings?.autoSpeakEnabled ? theme.primary : '#f4f3f4'}
            />
          </View>
          
          <View style={[styles.settingItem, { backgroundColor: theme.card }]}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Enable Voice Enhancement</Text>
            <Switch
              value={userSettings?.voiceSettings?.enhancementEnabled ?? false}
              onValueChange={handleToggleEnhancementSetting}
              disabled={isLoading}
              trackColor={{ false: '#767577', true: theme.primary + '50' }}
              thumbColor={userSettings?.voiceSettings?.enhancementEnabled ? theme.primary : '#f4f3f4'}
            />
          </View>

        </View>
        
        <View style={styles.section}>
          {/* Audio routing feature hidden until native implementation is complete
          <View style={[styles.settingItem, { backgroundColor: theme.card }]}>
            <View style={styles.settingLabelContainer}>
              <Text style={[styles.settingLabel, { color: theme.text }]}>
                Route Audio to Microphone
              </Text>
              <Text style={[styles.settingDescription, { color: theme.text + '80' }]}>
                Send synthesized speech to the microphone for use in other apps
              </Text>
            </View>
            <Switch
              value={isAudioRoutingEnabled}
              onValueChange={handleToggleAudioRouting}
              disabled={isLoading}
              trackColor={{ false: '#767577', true: theme.primary + '50' }}
              thumbColor={isAudioRoutingEnabled ? theme.primary : '#f4f3f4'}
            />
          </View>
          
          {isAudioRoutingEnabled && (
            <View style={styles.warningContainer}>
              <Text style={[styles.warningText, { color: '#FF9500' }]}>
                This feature routes audio to your microphone, allowing other apps to receive your synthesized voice.
              </Text>
            </View>
          )}
          */}
        </View>
        
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Voices</Text>
            
            <TouchableOpacity 
              style={styles.filterButton}
              onPress={() => setShowFavoritesOnly(!showFavoritesOnly)}
            >
              <Ionicons 
                name={showFavoritesOnly ? "heart" : "heart-outline"} 
                size={20} 
                color={showFavoritesOnly ? "#FF3B30" : theme.text + '80'} 
              />
              <Text style={[styles.filterButtonText, { color: theme.text }]}>
                {showFavoritesOnly ? 'All Voices' : 'Favorites Only'}
              </Text>
            </TouchableOpacity>
          </View>
          
          {loadingVoices ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.loadingText, { color: theme.text + '80' }]}>
                Loading voices...
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredVoices}
              renderItem={renderVoiceItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.voiceList}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: theme.text + '80' }]}>
                  {showFavoritesOnly 
                    ? 'No favorite voices yet. Add some by tapping the heart icon.' 
                    : 'No voices available. Pull down to refresh.'}
                </Text>
              }
              refreshing={isLoading}
              onRefresh={refreshSettings}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const makeStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginVertical: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: theme.border || theme.text + '20',
    marginVertical: 8,
    marginHorizontal: 16,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  settingLabel: {
    fontSize: 16,
  },
  settingLabelContainer: {
    flex: 1,
  },
  settingDescription: {
    fontSize: 12,
    marginTop: 4,
  },
  warningContainer: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 8,
  },
  warningText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  filterButtonText: {
    marginLeft: 4,
    fontSize: 14,
  },
  voiceList: {
    paddingHorizontal: 16,
  },
  voiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: theme.card,
  },
  voiceItemDisabled: {
    opacity: 0.6,
    backgroundColor: theme.background + '40',
  },
  voiceInfo: {
    flex: 1,
  },
  voiceNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voiceName: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.text,
  },
  selectedVoiceItem: {
    backgroundColor: theme.primary + '20',
    borderColor: theme.primary,
    borderWidth: 2,
  },
  textDisabled: {
    opacity: 0.5,
  },
  voiceAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 16,
  },
  avatarDisabled: {
    opacity: 0.5,
  },
  premiumBadge: {
    marginLeft: 8,
  },
  checkIcon: {
    marginLeft: 8,
  },
  voiceProvider: {
    fontSize: 14,
    color: theme.text + '80',
    marginTop: 2,
  },
  upgradePromptInline: {
    marginTop: 4,
  },
  playButton: {
    backgroundColor: theme.primary,
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonDisabled: {
    backgroundColor: theme.text + '40',
    opacity: 0.5,
  },
  separator: {
    height: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: theme.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 16,
    color: theme.text + '80',
    textAlign: 'center',
    marginTop: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  selectedVoiceName: {
    fontWeight: 'bold',
    color: theme.primary,
  },
});

export default VoiceSettingsScreen; 