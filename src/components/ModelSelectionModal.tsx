/**
 * ModelSelectionModal Component (React Native)
 * 
 * Modal for selecting between Standard and Premium voice models
 * Shows subscription status and feature comparison
 */

import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, ToastAndroid, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VOICE_MODELS, MODEL_CONFIG, resolveModelId } from '../utils/voiceModels';
import { useFeatureGate } from '../contexts/FeatureGateContext';

interface ModelSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  selectedModel?: string;
  onModelChange: (modelId: string) => Promise<void>;
  onLearnMore: () => void;
  theme: any;
}

export const ModelSelectionModal: React.FC<ModelSelectionModalProps> = ({
  visible,
  onClose,
  selectedModel: savedModel,
  onModelChange,
  onLearnMore,
  theme
}) => {
  const { t } = useTranslation();
  const selectedModel = resolveModelId(savedModel);
  const { canUseElevenV3, isPremiumUser, userPlan } = useFeatureGate();
  const [isChanging, setIsChanging] = useState(false);
  
  const standardConfig = MODEL_CONFIG[VOICE_MODELS.ELEVEN_LABS];
  const premiumConfig = MODEL_CONFIG[VOICE_MODELS.ELEVEN_LABS_PREMIUM];
  
  const handleSelectModel = async (modelId: string) => {
    // If selecting premium without subscription, show info modal
    if (modelId === VOICE_MODELS.ELEVEN_LABS_PREMIUM && !canUseElevenV3) {
      onLearnMore();
      return;
    }
    
    // Don't do anything if already selected
    if (modelId === selectedModel) {
      onClose();
      return;
    }
    
    try {
      setIsChanging(true);
      await onModelChange(modelId);
      
      // Show success message
      const modelName = modelId === VOICE_MODELS.ELEVEN_LABS_PREMIUM 
        ? t('modelSelector.premium')
        : t('modelSelector.standard');
      
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          t('modelSelection.switchSuccess', { model: modelName }),
          ToastAndroid.SHORT
        );
      } else {
        // iOS fallback
        Alert.alert(t('general.success'), t('modelSelection.switchSuccess', { model: modelName }));
      }
      
      onClose();
    } catch (error) {
      console.error('Error changing model:', error);
      Alert.alert(t('general.error'), 'Failed to change model. Please try again.');
    } finally {
      setIsChanging(false);
    }
  };
  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>
              {t('modelSelection.title')}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={[styles.closeButtonText, { color: theme.text }]}>✕</Text>
            </TouchableOpacity>
          </View>
          
          
          {/* Content */}
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Standard Model Card */}
            <TouchableOpacity
              style={[
                styles.modelCard,
                {
                  backgroundColor: theme.card,
                  borderColor: selectedModel === VOICE_MODELS.ELEVEN_LABS ? theme.primary : theme.border
                },
                selectedModel === VOICE_MODELS.ELEVEN_LABS && styles.selectedCard
              ]}
              onPress={() => handleSelectModel(VOICE_MODELS.ELEVEN_LABS)}
              disabled={isChanging}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>
                    {t('modelSelector.standard')}
                  </Text>
                  <View style={[styles.badge, styles.fastBadge]}>
                    <Text style={styles.badgeText}>⚡ {t('general.fast') || 'Fast'}</Text>
                  </View>
                </View>
                {selectedModel === VOICE_MODELS.ELEVEN_LABS && (
                  <View style={[styles.checkmark, { backgroundColor: theme.primary }]}>
                    <Text style={styles.checkmarkText}>✓</Text>
                  </View>
                )}
              </View>
              
              <Text style={[styles.cardDescription, { color: theme.text + 'CC' }]}>
                {t('modelSelector.standardDesc')}
              </Text>
              
              <View style={styles.features}>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  💰 {t('modelSelector.costEfficient')}
                </Text>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  🎭 {t('modelSelector.emotionalVoices')}
                </Text>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  📝 {t('modelSelector.characterLimit', { limit: '10K' })}
                </Text>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  ⚡ {t('general.fast') || 'Ultra-low latency'} (~100ms)
                </Text>
              </View>
            </TouchableOpacity>
            
            {/* Premium Model Card */}
            <TouchableOpacity
              style={[
                styles.modelCard,
                {
                  backgroundColor: theme.card,
                  borderColor: selectedModel === VOICE_MODELS.ELEVEN_LABS_PREMIUM ? theme.primary : theme.border,
                  opacity: canUseElevenV3 ? 1 : 0.7
                },
                selectedModel === VOICE_MODELS.ELEVEN_LABS_PREMIUM && styles.selectedCard
              ]}
              onPress={() => handleSelectModel(VOICE_MODELS.ELEVEN_LABS_PREMIUM)}
              disabled={isChanging}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>
                    {t('modelSelector.premium')}
                  </Text>
                  <View style={[styles.badge, styles.emotionalBadge]}>
                    <Text style={styles.badgeText}>🎭 Emotional</Text>
                  </View>
                  <View style={[styles.badge, styles.alphaBadge]}>
                    <Text style={styles.badgeText}>🔬 {t('modelSelector.experimental')}</Text>
                  </View>
                </View>
                {selectedModel === VOICE_MODELS.ELEVEN_LABS_PREMIUM ? (
                  <View style={[styles.checkmark, { backgroundColor: theme.primary }]}>
                    <Text style={styles.checkmarkText}>✓</Text>
                  </View>
                ) : !canUseElevenV3 && (
                  <View style={[styles.lockIcon, { backgroundColor: theme.border }]}>
                    <Text style={styles.lockText}>🔒</Text>
                  </View>
                )}
              </View>
              
              <Text style={[styles.cardDescription, { color: theme.text + 'CC' }]}>
                {t('modelSelector.premiumDesc')}
              </Text>
              
              <View style={styles.features}>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  🎭 {t('modelSelector.emotionalVoices')}
                </Text>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  🌍 70+ languages
                </Text>
                <Text style={[styles.featureText, { color: theme.text + '99' }]}>
                  📝 {t('modelSelector.characterLimit', { limit: '3K' })}
                </Text>
              </View>
              
              {!canUseElevenV3 && (
                <View style={[styles.lockMessage, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
                  <Text style={[styles.lockMessageText, { color: theme.primary }]}>
                    🔒 {t('modelSelector.premiumRequired')}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            
            {/* Learn More Link */}
            <TouchableOpacity onPress={onLearnMore} style={styles.learnMoreButton}>
              <Text style={[styles.learnMoreText, { color: theme.primary }]}>
                📚 {t('modelSelector.learnMore')} {t('modelSelector.experimentalWarning')} →
              </Text>
            </TouchableOpacity>
            
            <View style={styles.spacer} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end'
  },
  container: {
    height: '85%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1
  },
  title: {
    fontSize: 20,
    fontWeight: '700'
  },
  closeButton: {
    padding: 4
  },
  closeButtonText: {
    fontSize: 24,
    fontWeight: '300'
  },
  planInfo: {
    margin: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center'
  },
  planText: {
    fontSize: 14,
    fontWeight: '600'
  },
  content: {
    flex: 1,
    padding: 16
  },
  modelCard: {
    borderRadius: 16,
    borderWidth: 2,
    padding: 20,
    marginBottom: 16
  },
  selectedCard: {
    borderWidth: 3
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12
  },
  cardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700'
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12
  },
  fastBadge: {
    backgroundColor: '#10B981'
  },
  emotionalBadge: {
    backgroundColor: '#8B5CF6'
  },
  alphaBadge: {
    backgroundColor: '#F59E0B'
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600'
  },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center'
  },
  checkmarkText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  lockIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center'
  },
  lockText: {
    fontSize: 14
  },
  cardDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16
  },
  features: {
    gap: 8
  },
  featureText: {
    fontSize: 13,
    lineHeight: 18
  },
  lockMessage: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1
  },
  lockMessageText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center'
  },
  learnMoreButton: {
    padding: 16,
    marginTop: 8
  },
  learnMoreText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center'
  },
  spacer: {
    height: 20
  }
});

