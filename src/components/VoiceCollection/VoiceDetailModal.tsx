import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  Image,
  Alert,
  Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Voice } from '../../services/ttsService';
import { useTextToSpeech } from '../../hooks/useTextToSpeech';
import { useFeatureGate } from '../../contexts/FeatureGateContext';
import { useTranslation } from 'react-i18next';
import { PremiumBadge, UpgradePrompt } from '../UI';
import { canShowPurchaseOptions } from '../../config/purchases';

interface VoiceDetailModalProps {
  visible: boolean;
  onClose: () => void;
  voice: Voice | null;
  onToggleFavorite: (voice: Voice) => Promise<void>;
  onSelectVoice: (voice: Voice) => Promise<void>;
  isFavorite: boolean;
  isSelected: boolean;
  theme: any;
}

const VoiceDetailModal: React.FC<VoiceDetailModalProps> = ({
  visible,
  onClose,
  voice,
  onToggleFavorite,
  onSelectVoice,
  isFavorite,
  isSelected,
  theme
}) => {
  const { t } = useTranslation();
  const { 
    isLoading: isTTSHookLoading, 
    isPlaying: isTTSHookPlaying, 
    stopSpeaking, 
    previewVoice 
  } = useTextToSpeech();
  const featureGate = useFeatureGate();
  
  const [isModalButtonLoading, setIsModalButtonLoading] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [selectLoading, setSelectLoading] = useState(false);
  const [showSubscriptionError, setShowSubscriptionError] = useState(false);

  if (!voice) return null;

  // Voice access control - NOW USING FEATUREGATE
  const isPremiumVoice = voice.isPremium || voice.accessLevel === 'premium';
  const canPreview = featureGate.canPreviewVoice(isPremiumVoice);
  const canSelect = featureGate.canSelectVoice(isPremiumVoice);
  const requiresUpgrade = isPremiumVoice && !featureGate.canAccessPremiumVoices;

  const playVoiceSample = async () => {
    if (isTTSHookPlaying) { // If sound is actually playing globally from the hook
      console.log('[VDM] Stop command due to isTTSHookPlaying being true');
      stopSpeaking();
      // isModalButtonLoading should ideally be false here, or will be cleared by its own finally block if it was the source
      return;
    }

    if (isModalButtonLoading) { // If modal button shows its own spinner and user clicks it again to cancel
      console.log('[VDM] Stop command due to isModalButtonLoading being true (cancel attempt)');
      stopSpeaking(); // Attempt to cancel any operation initiated by this modal
      setIsModalButtonLoading(false);
      return;
    }

    // Check access before attempting preview
    if (!canPreview) {
      console.log('[VDM] Preview denied - user does not have access to this voice');
      return;
    }

    // Start a new preview if neither of the above conditions were met
    console.log('[VDM] Starting new preview for voice:', voice.id);
    setIsModalButtonLoading(true);
    // Reset subscription error state
    setShowSubscriptionError(false);
    
    try {
      await previewVoice(
        voice.id,
        voice.provider,
        voice.public_owner_id || voice.publicOwnerId,
        voice.name,
        voice.language || voice.languageCode
      );
      // If previewVoice completes, the sound might be about to play or is already playing.
      // isTTSHookPlaying will reflect actual playback. isModalButtonLoading will be set to false in finally.
      console.log('[VDM] previewVoice call completed for:', voice.id);
    } catch (error) {
      console.error('[VDM] Failed to play voice sample in modal for voice:', voice.id, error);
      
      // Check for subscription limit error
      if (error instanceof Error) {
        const errorMessage = error.message;
        const isLimitError = 
          errorMessage.includes('LIMIT_EXCEEDED') || 
          errorMessage.includes('429') || 
          errorMessage.includes('limit');
          
        if (isLimitError) {
          setShowSubscriptionError(true);
          
          if (!canShowPurchaseOptions()) {
            Alert.alert(
              t('subscription.noCreditsTitle', 'Credits Exhausted'),
              t('subscription.noCreditsMessage', "You've used all your credits for this month.")
            );
            return;
          }

          // Optional: show an alert with upgrade option
          Alert.alert(
            t('subscription.limitTitle', 'Subscription Limit Reached'),
            t('subscription.limitMessage', 'You have reached your monthly TTS usage limit. Upgrade your plan for unlimited access.'),
            [
              {
                text: t('general.later', 'Later'),
                style: 'cancel'
              },
              {
                text: t('subscription.upgrade', 'Upgrade'),
                onPress: () => {
                  const url = 'https://speech-aac.link/en/profile?upgrade=true';
                  Linking.openURL(url).catch(err => {
                    console.error('Failed to open upgrade URL:', err);
                  });
                }
              }
            ]
          );
        }
      }
      // Error state is typically managed within useTextToSpeech hook itself (e.g., setting an error prop)
    } finally {
      setIsModalButtonLoading(false); // Modal's own button spinner stops once previewVoice promise settles
    }
  };

  const handleToggleFavorite = async () => {
    if (!voice) return;
    setFavoriteLoading(true);
    try {
      await onToggleFavorite(voice);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleSelectVoice = async () => {
    if (!voice) return;
    
    // Check access before allowing selection
    if (!canSelect) {
      console.log('[VDM] Selection denied - user does not have access to this voice');
      return;
    }
    
    setSelectLoading(true);
    try {
      await onSelectVoice(voice);
      
      // Close the modal after selecting the voice
      onClose();
    } finally {
      setSelectLoading(false);
    }
  };

  // Generate avatar URL with proper colors
  const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(voice.name)}&background=4A6FEA&color=fff`;

  // Translate metadata fields
  const getTranslatedGender = (gender?: string) => {
    if (!gender) return t('general.notSpecified');
    return t(`voice.metadata.gender.${gender}`, gender.charAt(0).toUpperCase() + gender.slice(1));
  };

  const getTranslatedAge = (age?: string) => {
    if (!age) return t('general.notSpecified');
    return t(`voice.metadata.age.${age}`, age.charAt(0).toUpperCase() + age.slice(1));
  };

  const getTranslatedAccent = (accent?: string) => {
    if (!accent) return t('general.notSpecified');
    return t(`voice.metadata.accent.${accent}`, accent.charAt(0).toUpperCase() + accent.slice(1));
  };

  const getTranslatedUseCase = (useCase?: string) => {
    if (!useCase) return t('general.general');
    return t(`voice.metadata.useCase.${useCase}`, useCase.charAt(0).toUpperCase() + useCase.slice(1));
  };

  // Get label/value pairs for all voice attributes we want to display
  const detailsItems = [
    { label: t('voice.labels.name'), value: voice.name },
    { label: t('voice.labels.language'), value: voice.language || 'English' },
    { label: t('voice.labels.gender'), value: getTranslatedGender(voice.gender) },
    { label: t('voice.labels.accent'), value: getTranslatedAccent(voice.accent) },
    { label: t('voice.labels.age'), value: getTranslatedAge(voice.age) },
    { label: t('voice.labels.useCase'), value: getTranslatedUseCase(voice.use_case) },
  ];

  // Add description only if it exists
  if (voice.description) {
    detailsItems.push({ 
      label: t('voice.labels.description'), 
      value: voice.description 
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.headerLeft}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {t('voice.modal.title', 'Voice Details')}
                </Text>
                {isPremiumVoice && (
                  <PremiumBadge size="small" style={styles.premiumBadge} />
                )}
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollView}>
              {/* Voice avatar and name section */}
              <View style={styles.voiceProfileSection}>
                <Image source={{ uri: avatarUrl }} style={styles.voiceAvatar} />
                <View style={styles.nameContainer}>
                  <Text style={[styles.voiceName, { color: theme.text }]}>{voice.name}</Text>
                  <View style={styles.badgeContainer}>
                    <View style={[styles.providerBadge, { backgroundColor: theme.primary }]}>
                      <Text style={styles.providerText}>ElevenLabs</Text>
                    </View>
                    {voice.gender && (
                      <View style={styles.genderBadge}>
                        <Ionicons
                          name={voice.gender === 'male' ? 'male' : voice.gender === 'female' ? 'female' : 'person'}
                          size={14}
                          color="#FFFFFF"
                        />
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* Voice details section */}
              <View style={styles.detailsSection}>
                {detailsItems.map((item, index) => (
                  <View key={index} style={styles.detailItem}>
                    <Text style={[styles.detailLabel, { color: theme.text + '80' }]}>{item.label}</Text>
                    <Text style={[styles.detailValue, { color: theme.text }]}>{item.value}</Text>
                  </View>
                ))}
              </View>
              
              {/* Show upgrade prompt if voice requires premium but user doesn't have access */}
              {requiresUpgrade && (
                <UpgradePrompt
                  variant="card"
                  size="medium"
                  title={t('upgrade.premiumVoiceTitle', 'Premium Voice Access')}
                  message={t('upgrade.premiumVoiceFullMessage', 'This premium voice requires an Intensive or Daily Companion plan. Upgrade now to unlock all premium voices and features.')}
                  style={styles.upgradePrompt}
                />
              )}
            </ScrollView>

            {/* Footer with action buttons */}
            <View style={styles.modalFooter}>
              <TouchableOpacity 
                style={[
                  styles.favoriteButton,
                  { backgroundColor: isFavorite ? theme.error : 'transparent' },
                  { borderColor: isFavorite ? theme.error : theme.text + '40' }
                ]}
                onPress={handleToggleFavorite}
                disabled={favoriteLoading}
              >
                {favoriteLoading ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <Ionicons
                    name={isFavorite ? "heart" : "heart-outline"}
                    size={20}
                    color={isFavorite ? "#FFFFFF" : theme.text}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={[
                  styles.previewButton,
                  { backgroundColor: canPreview ? theme.primary : theme.text + '40' },
                  (isModalButtonLoading || !canPreview) && { opacity: 0.7 }
                ]}
                onPress={playVoiceSample}
                disabled={isModalButtonLoading || !canPreview}
              >
                {isModalButtonLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons
                      name={isTTSHookPlaying ? "stop" : "play"}
                      size={18}
                      color="#FFFFFF"
                    />
                    <Text style={styles.previewButtonText}>
                      {isTTSHookPlaying 
                        ? t('voice.actions.stop', 'Stop')
                        : t('voice.actions.preview', 'Preview')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={[
                  styles.selectButton,
                  isSelected 
                    ? { backgroundColor: theme.success, borderColor: theme.success }
                    : canSelect
                      ? { backgroundColor: theme.primary, borderColor: theme.primary }
                      : { backgroundColor: theme.text + '40', borderColor: theme.text + '40' },
                  (selectLoading || (!canSelect && !isSelected)) && { opacity: 0.7 }
                ]}
                onPress={handleSelectVoice}
                disabled={selectLoading || (!canSelect && !isSelected)}
              >
                {selectLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons
                      name={isSelected ? "checkmark-circle" : canSelect ? "radio-button-off" : "lock-closed"}
                      size={18}
                      color="#FFFFFF"
                    />
                    <Text style={styles.selectButtonText}>
                      {isSelected 
                        ? t('voice.actions.selected', 'Selected')
                        : canSelect
                          ? t('voice.actions.select', 'Select')
                          : t('voice.actions.selection', 'Selection')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    minHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  premiumBadge: {
    marginLeft: 8,
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  voiceProfileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  voiceAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 16,
  },
  nameContainer: {
    flex: 1,
  },
  voiceName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  providerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  genderBadge: {
    backgroundColor: '#757575',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsSection: {
    marginBottom: 20,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  detailLabel: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  detailValue: {
    fontSize: 16,
    flex: 1,
    textAlign: 'right',
  },
  upgradePrompt: {
    marginBottom: 20,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    gap: 12,
  },
  favoriteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  previewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  previewButtonText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  selectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  selectButtonText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});

export default VoiceDetailModal; 