import React, { useState, useContext, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

// Context
import { ThemeContext } from '../../../contexts/ThemeContext';

// Services
import { aacService } from '../../../services/aacService';

// Models
import { 
  SampleSentence,
  CategoryUIModel,
  SentenceUIModel,
  mapToBackendSentenceModel
} from '../../../models/AAC';

// Components
import { IconPicker, IconSelection } from '../../../components/AAC/IconPicker';
import { ColorPicker } from '../../../components/AAC/ColorPicker';
import { EmotionalTagSelector } from '../../../components/EmotionalTagSelector';
import { insertTagAtPosition, EmotionalTag } from '../../../utils/emotionalTags';

interface SentenceFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (sentence: SentenceUIModel) => void;
  categories: CategoryUIModel[];
  editSentence?: SentenceUIModel;
  currentLanguage: string;
}

const SentenceFormModal: React.FC<SentenceFormModalProps> = ({
  visible,
  onClose,
  onSave,
  categories,
  editSentence,
  currentLanguage
}) => {
  const { t } = useTranslation();
  const { theme } = useContext(ThemeContext);
  
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [iconSelection, setIconSelection] = useState<IconSelection | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showEmotionalTags, setShowEmotionalTags] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ text?: string; categoryId?: string }>({});
  const [cursorPosition, setCursorPosition] = useState(0);
  const textInputRef = React.useRef<TextInput>(null);
  
  // Reset form when visibility changes or editSentence changes
  useEffect(() => {
    if (visible) {
      if (editSentence) {
        setText(editSentence.text);
        setCategoryId(editSentence.categoryId);
        setColor(editSentence.color || null);
        // Set cursor position to end of text when editing
        setCursorPosition(editSentence.text.length);
        if (editSentence.icon && editSentence.iconType) {
          setIconSelection({
            icon: editSentence.icon,
            iconType: editSentence.iconType as 'ionicon' | 'emoji',
          });
        } else {
          setIconSelection(null);
        }
      } else {
        // For new sentences, pre-select first category if available
        setText('');
        // Find the first category that's not "all"
        const firstRealCategory = categories.find(c => c.id !== 'all');
        setCategoryId(firstRealCategory ? firstRealCategory.id : '');
        setColor(null);
        setIconSelection(null);
        setCursorPosition(0);
      }
      setErrors({});
      setShowColorPicker(false);
      setShowIconPicker(false);
      setShowEmotionalTags(false);
    }
  }, [visible, editSentence, categories]);
  
  // Handle emotional tag selection
  const handleTagSelect = (tag: EmotionalTag) => {
    const result = insertTagAtPosition(text, tag.value, cursorPosition);
    setText(result.newText);
    setCursorPosition(result.newCursorPosition);
    // Focus back on input
    setTimeout(() => textInputRef.current?.focus(), 100);
  };
  
  const styles = makeStyles(theme);
  
  const validateForm = (): boolean => {
    const newErrors: { text?: string; categoryId?: string } = {};
    
    if (!text.trim()) {
      newErrors.text = t('general.error.required');
    } else if (text.length > 5000) {
      newErrors.text = t('general.error.maxLength', { max: 5000 });
    }
    
    if (!categoryId) {
      newErrors.categoryId = t('general.error.required');
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleSave = async () => {
    if (!validateForm()) return;
    
    try {
      setIsSaving(true);
      
      // Create sentence model
      const sentenceModel: SentenceUIModel = {
        id: editSentence?.id || `temp-${Date.now()}`,
        text: text.trim(),
        categoryId,
        isFavorite: editSentence?.isFavorite || false,
        color: color || undefined,
        icon: iconSelection?.icon || undefined,
        iconType: iconSelection?.iconType || undefined,
      };
      
      // Map to backend model
      const backendModel = mapToBackendSentenceModel(sentenceModel, currentLanguage);
      
      let savedSentence: SampleSentence;
      
      if (editSentence && editSentence.id) {
        // Update existing sentence (only if it has a valid ID)
        savedSentence = await aacService.updateSentence(editSentence.id, backendModel);
      } else {
        // Create new sentence
        savedSentence = await aacService.createSentence(backendModel);
      }
      
      // Map back to UI model and pass to parent
      const result: SentenceUIModel = {
        id: savedSentence.id,
        text: savedSentence.text,
        categoryId: savedSentence.categoryId,
        isFavorite: savedSentence.isFavorite,
        color: savedSentence.color,
        icon: savedSentence.icon,
        iconType: savedSentence.iconType,
      };
      
      onSave(result);
      onClose();
    } catch (error) {
      console.error('Error saving sentence:', error);
      Alert.alert(
        t('general.error.title'),
        t('aacBoard.errorSavingSentence')
      );
    } finally {
      setIsSaving(false);
    }
  };
  
  const getCategoryById = (id: string) => {
    return categories.find(c => c.id === id);
  };

  const categoryName = getCategoryById(categoryId)?.name || '';
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {editSentence ? t('aac.phrases.edit') : t('aac.phrases.add')}
              </Text>
              <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView 
              style={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>{t('aacBoard.category')}</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoriesContainer}
                >
                  {categories.map(category => (
                    <TouchableOpacity
                      key={category.id}
                      style={[
                        styles.categoryChip,
                        categoryId === category.id && styles.selectedCategoryChip,
                        { borderColor: category.color }
                      ]}
                      onPress={() => setCategoryId(category.id)}
                    >
                      <Ionicons 
                        name={category.icon as any} 
                        size={16} 
                        color={categoryId === category.id ? '#FFFFFF' : category.color} 
                      />
                      <Text 
                        style={[
                          styles.categoryChipText,
                          categoryId === category.id && styles.selectedCategoryChipText
                        ]}
                      >
                        {category.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {errors.categoryId ? (
                  <Text style={styles.errorText}>{errors.categoryId}</Text>
                ) : null}
                
                {categoryId && (
                  <View style={styles.selectedCategory}>
                    <Text style={styles.selectedCategoryLabel}>
                      {t('aacBoard.selectedCategory')}:
                    </Text>
                    <View 
                      style={[
                        styles.selectedCategoryBadge,
                        { backgroundColor: getCategoryById(categoryId)?.color || theme.primary }
                      ]}
                    >
                      <Text style={styles.selectedCategoryText}>
                        {getCategoryById(categoryId)?.isGlobal 
                          ? categoryName 
                          : categoryName}
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Color Customization */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{t('aacBoard.color') || 'Color'}</Text>
                <TouchableOpacity
                  style={styles.customizationButton}
                  onPress={() => setShowColorPicker(!showColorPicker)}
                >
                  <View
                    style={[
                      styles.colorPreview,
                      { backgroundColor: color || getCategoryById(categoryId)?.color || '#8B5CF6' },
                    ]}
                  />
                  <Text style={styles.customizationButtonText}>
                    {color ? 'Custom color' : 'Using category color'}
                  </Text>
                  <Ionicons
                    name={showColorPicker ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={theme.text}
                  />
                </TouchableOpacity>
                {showColorPicker && (
                  <View style={styles.pickerContainer}>
                    <ColorPicker
                      value={color}
                      onSelect={setColor}
                      categoryColor={getCategoryById(categoryId)?.color || '#8B5CF6'}
                      theme={theme}
                    />
                  </View>
                )}
              </View>

              {/* Icon Customization */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{t('aacBoard.icon') || 'Icon (Optional)'}</Text>
                <TouchableOpacity
                  style={styles.customizationButton}
                  onPress={() => setShowIconPicker(!showIconPicker)}
                >
                  {iconSelection ? (
                    iconSelection.iconType === 'emoji' ? (
                      <Text style={styles.iconPreviewEmoji}>{iconSelection.icon}</Text>
                    ) : (
                      <Ionicons name={iconSelection.icon as any} size={24} color={theme.text} />
                    )
                  ) : (
                    <Ionicons
                      name={(getCategoryById(categoryId)?.icon || 'chatbubble-outline') as any}
                      size={24}
                      color={theme.text + '60'}
                    />
                  )}
                  <Text style={styles.customizationButtonText}>
                    {iconSelection ? 'Custom icon' : 'Using category icon'}
                  </Text>
                  <Ionicons
                    name={showIconPicker ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={theme.text}
                  />
                </TouchableOpacity>
                {showIconPicker && (
                  <View style={styles.pickerContainer}>
                    <IconPicker
                      value={iconSelection}
                      onSelect={(icon, iconType) => setIconSelection({ icon, iconType })}
                      categoryIcon={getCategoryById(categoryId)?.icon}
                      theme={theme}
                    />
                  </View>
                )}
              </View>

              {/* Emotional Tags */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{t('emotionalTags.title') || 'Emotional Tags'}</Text>
                <TouchableOpacity
                  style={styles.customizationButton}
                  onPress={() => setShowEmotionalTags(!showEmotionalTags)}
                >
                  <Ionicons
                    name="happy-outline"
                    size={24}
                    color={theme.text}
                  />
                  <Text style={styles.customizationButtonText}>
                    {t('emotionalTags.title')}
                  </Text>
                  <Ionicons
                    name={showEmotionalTags ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={theme.text}
                  />
                </TouchableOpacity>
                {showEmotionalTags && (
                  <View style={styles.pickerContainer}>
                    <EmotionalTagSelector
                      onTagSelect={handleTagSelect}
                      theme={theme}
                      maxHeight={300}
                    />
                  </View>
                )}
              </View>

              <View style={[styles.formGroup, styles.phraseFormGroup]}>
                <Text style={styles.label}>{t('aacBoard.phraseText')}</Text>
                <TextInput
                  ref={textInputRef}
                  style={[styles.input, errors.text ? styles.inputError : null]}
                  value={text}
                  onChangeText={setText}
                  onSelectionChange={(e) => {
                    setCursorPosition(e.nativeEvent.selection.start);
                  }}
                  placeholder={t('aacBoard.enterPhraseText')}
                  placeholderTextColor={theme.text + '60'}
                  multiline
                  maxLength={200}
                />
                {errors.text ? (
                  <Text style={styles.errorText}>{errors.text}</Text>
                ) : null}
                <Text style={styles.charCounter}>
                  {text.length}/200
                </Text>
              </View>
            </ScrollView>
            
            <View style={styles.footer}>
              <TouchableOpacity 
                style={styles.cancelButton} 
                onPress={onClose}
                disabled={isSaving}
              >
                <Text style={styles.cancelButtonText}>{t('general.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('general.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const makeStyles = (theme: any) => StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: theme.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: '50%',
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  closeButton: {
    padding: 8,
  },
  content: {
    padding: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.card,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    fontSize: 16,
    color: theme.text,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginTop: 4,
  },
  charCounter: {
    alignSelf: 'flex-end',
    fontSize: 12,
    color: theme.text + '80',
    marginTop: 4,
  },
  categoriesContainer: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingVertical: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  selectedCategoryChip: {
    backgroundColor: theme.primary,
  },
  categoryChipText: {
    color: theme.text,
    marginLeft: 6,
    fontSize: 14,
  },
  selectedCategoryChipText: {
    color: '#FFFFFF',
  },
  selectedCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  selectedCategoryLabel: {
    fontSize: 14,
    color: theme.text,
    marginRight: 8,
  },
  selectedCategoryBadge: {
    backgroundColor: theme.primary,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  selectedCategoryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '500',
  },
  saveButton: {
    backgroundColor: theme.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginLeft: 8,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: theme.primary + '80',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  phraseFormGroup: {
    marginTop: 20,
  },
  customizationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  customizationButtonText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: theme.text,
  },
  colorPreview: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  iconPreviewEmoji: {
    fontSize: 28,
  },
  pickerContainer: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    maxHeight: 400,
    overflow: 'hidden',
  },
});

export default SentenceFormModal; 