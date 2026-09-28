/**
 * ModelSelector Component (React Native)
 * 
 * Button that opens a modal to select between standard and premium TTS models
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VOICE_MODELS, resolveModelId } from '../utils/voiceModels';
import { ModelSelectionModal } from './ModelSelectionModal';
import { ModelInfoModal } from './ModelInfoModal';

interface ModelSelectorProps {
  selectedModel?: string;
  onModelChange: (modelId: string) => Promise<void>;
  theme: any;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel = VOICE_MODELS.ELEVEN_LABS,
  onModelChange,
  theme
}) => {
  const { t } = useTranslation();
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  
  // Determine current model display
  const isStandard = resolveModelId(selectedModel) === VOICE_MODELS.ELEVEN_LABS;
  const modelIcon = isStandard ? '⚡' : '🎭';
  const modelName = isStandard ? t('modelSelector.standard') : t('modelSelector.premium');
  
  const handleLearnMore = () => {
    setShowInfoModal(true);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.text }]}>{t('modelSelector.title')}</Text>
      
      {/* Model Selection Button */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: theme.card, borderColor: theme.border }]}
        onPress={() => setShowSelectionModal(true)}
      >
        <View style={styles.buttonContent}>
          <View style={styles.modelInfo}>
            <Text style={styles.modelIcon}>{modelIcon}</Text>
            <View style={styles.modelTextContainer}>
              <Text style={[styles.modelName, { color: theme.text }]}>{modelName}</Text>
              <Text style={[styles.currentLabel, { color: theme.text + '80' }]}>
                {t('modelSelection.currentModel', { model: '' })}
              </Text>
            </View>
          </View>
          <View style={styles.changeButton}>
            <Text style={[styles.changeText, { color: theme.primary }]}>
              {t('modelSelection.changeModel')} →
            </Text>
          </View>
        </View>
      </TouchableOpacity>
      
      {/* Model Selection Modal */}
      <ModelSelectionModal
        visible={showSelectionModal}
        onClose={() => setShowSelectionModal(false)}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        onLearnMore={handleLearnMore}
        theme={theme}
      />
      
      {/* Model Info Modal */}
      <ModelInfoModal
        visible={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        theme={theme}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8
  },
  button: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16
  },
  buttonContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  modelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12
  },
  modelIcon: {
    fontSize: 24
  },
  modelTextContainer: {
    flex: 1
  },
  modelName: {
    fontSize: 16,
    fontWeight: '600'
  },
  currentLabel: {
    fontSize: 12,
    marginTop: 2
  },
  changeButton: {
    paddingLeft: 12
  },
  changeText: {
    fontSize: 14,
    fontWeight: '600'
  }
});
