import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../contexts/ThemeContext';

interface AddEditEntryModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (word: string, pronunciation: string) => Promise<void>;
  onPreview: (pronunciation: string) => Promise<void>;
  initialWord?: string;
  initialPronunciation?: string;
  isEditing?: boolean;
  language: string;
}

const AddEditEntryModal: React.FC<AddEditEntryModalProps> = ({
  visible,
  onClose,
  onSave,
  onPreview,
  initialWord = '',
  initialPronunciation = '',
  isEditing = false,
  language,
}) => {
  const { t } = useTranslation();
  const { theme } = useContext(ThemeContext);
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();

  const [word, setWord] = useState(initialWord);
  const [pronunciation, setPronunciation] = useState(initialPronunciation);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Update form when modal opens with editing data
  useEffect(() => {
    if (visible) {
      setWord(initialWord);
      setPronunciation(initialPronunciation);
    }
  }, [visible, initialWord, initialPronunciation]);

  const handleSave = async () => {
    if (!word.trim() || !pronunciation.trim()) {
      return;
    }

    try {
      setIsSaving(true);
      await onSave(word.trim(), pronunciation.trim());
      // Modal will be closed by parent component
    } catch (error) {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!pronunciation.trim()) {
      return;
    }

    try {
      setIsPreviewing(true);
      await onPreview(pronunciation.trim());
    } catch (error) {
      // Error handled by parent
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleClose = () => {
    setWord('');
    setPronunciation('');
    onClose();
  };

  const isValid = word.trim().length > 0 && pronunciation.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        {/* Bottom inset keeps the action buttons above the Android nav bar (edge-to-edge) / iOS home indicator */}
        <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isEditing
                  ? t('pronunciation.editEntry') || 'Edit Entry'
                  : t('pronunciation.addEntry') || 'Add Entry'}
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Language Info */}
            <View style={styles.languageInfo}>
              <Ionicons name="globe-outline" size={16} color={theme.primary} />
              <Text style={styles.languageInfoText}>
                {t('pronunciation.languageInfo') || 'Entry will be added to'}{' '}
                <Text style={styles.languageInfoHighlight}>
                  {t(`languages.${language}`) || language.toUpperCase()}
                </Text>
              </Text>
            </View>

            {/* Word Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {t('pronunciation.word') || 'Word'} *
              </Text>
              <TextInput
                style={styles.input}
                value={word}
                onChangeText={setWord}
                placeholder={t('pronunciation.wordPlaceholder') || 'Enter the word...'}
                placeholderTextColor={theme.text + '60'}
                maxLength={100}
                autoCapitalize="none"
                editable={!isSaving}
              />
              <Text style={styles.characterCount}>{word.length}/100</Text>
            </View>

            {/* Pronunciation Input */}
            <View style={styles.inputGroup}>
              <View style={styles.pronunciationHeader}>
                <Text style={styles.inputLabel}>
                  {t('pronunciation.pronunciation') || 'Pronunciation'} *
                </Text>
                {pronunciation.trim().length > 0 && (
                  <TouchableOpacity
                    style={[styles.previewButton, isPreviewing && styles.previewButtonDisabled]}
                    onPress={handlePreview}
                    disabled={isPreviewing}
                  >
                    {isPreviewing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="play" size={16} color="#FFFFFF" />
                        <Text style={styles.previewButtonText}>
                          {t('pronunciation.preview') || 'Preview'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={[styles.input, styles.pronunciationInput]}
                value={pronunciation}
                onChangeText={setPronunciation}
                placeholder={t('pronunciation.pronunciationPlaceholder') || 'How it should sound...'}
                placeholderTextColor={theme.text + '60'}
                maxLength={200}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoCapitalize="none"
                editable={!isSaving}
              />
              <Text style={styles.characterCount}>{pronunciation.length}/200</Text>
            </View>

            {/* Help Text */}
            <View style={styles.helpContainer}>
              <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
              <Text style={styles.helpText}>
                {t('pronunciation.helpText') ||
                  'Enter a phonetic spelling or creative text that makes the voice say the word correctly. For example: "Kurko" → "Kurkuü"'}
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleClose}
                disabled={isSaving}
              >
                <Text style={styles.cancelButtonText}>
                  {t('pronunciation.cancel') || 'Cancel'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.saveButton,
                  (!isValid || isSaving) && styles.saveButtonDisabled,
                ]}
                onPress={handleSave}
                disabled={!isValid || isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {isEditing
                      ? t('pronunciation.update') || 'Update'
                      : t('pronunciation.add') || 'Add'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const makeStyles = (theme: any) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContent: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
    },
    closeButton: {
      padding: 4,
    },
    languageInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: theme.primary + '15',
      marginHorizontal: 20,
      marginTop: 16,
      borderRadius: 8,
    },
    languageInfoText: {
      fontSize: 14,
      color: theme.text,
    },
    languageInfoHighlight: {
      fontWeight: '600',
      color: theme.primary,
    },
    inputGroup: {
      paddingHorizontal: 20,
      marginTop: 20,
    },
    inputLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 8,
    },
    pronunciationHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    input: {
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.text,
    },
    pronunciationInput: {
      minHeight: 80,
    },
    characterCount: {
      fontSize: 12,
      color: theme.text + '60',
      marginTop: 4,
      textAlign: 'right',
    },
    previewButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    previewButtonDisabled: {
      opacity: 0.5,
    },
    previewButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
    helpContainer: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 20,
      marginTop: 16,
      padding: 12,
      backgroundColor: theme.card,
      marginHorizontal: 20,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: theme.primary,
    },
    helpText: {
      flex: 1,
      fontSize: 13,
      color: theme.text + '80',
      lineHeight: 18,
    },
    actionButtons: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 20,
      marginTop: 24,
    },
    button: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cancelButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
    saveButton: {
      backgroundColor: theme.primary,
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },
  });

export default AddEditEntryModal;



