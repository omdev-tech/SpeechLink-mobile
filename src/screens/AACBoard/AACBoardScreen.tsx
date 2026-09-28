import React, { useState, useContext, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  Linking,
  Dimensions,
  Animated,
  KeyboardAvoidingView,
  Modal
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenHeader } from '../../components/UI/ScreenHeader';

// Context
import { ThemeContext } from '../../contexts/ThemeContext';
import { useDiscord } from '../../contexts/DiscordContext';
import { useTutorial } from '../../contexts/TutorialContext';

// Services
import { useTextToSpeech } from '../../hooks/useTextToSpeech';
import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import { aacService } from '../../services/aacService';

// New components for emotional tags & model selection
import { ModelSelector } from '../../components/ModelSelector';
import { EmotionalTagSelector } from '../../components/EmotionalTagSelector';
import { ModelInfoModal } from '../../components/ModelInfoModal';
import { ModelSelectionModal } from '../../components/ModelSelectionModal';
import { VOICE_MODELS, getCharacterLimit, resolveModelId } from '../../utils/voiceModels';
import { insertTagAtPosition, EmotionalTag } from '../../utils/emotionalTags';
import { canUseElevenV3 } from '../../utils/subscriptionUtils';

// Tutorial
import { TutorialTarget } from '../../components/Tutorial/TutorialTarget';

// Models
import { 
  SentenceCategory, 
  SampleSentence,
  CategoryUIModel,
  SentenceUIModel,
  AACPreferences,
  mapToUICategoryModel,
  mapToUISentenceModel,
  deduplicateSentences
} from '../../models/AAC';

// Components
import SentenceFormModal from './components/SentenceFormModal';
import CategoryFormModal from './components/CategoryFormModal';
import SentenceReorderMode from './components/SentenceReorderMode';
import DiscordIndicator from '../../components/UI/DiscordIndicator';
import { CreditLimitModal } from '../../components/UI/CreditLimitModal';

// Debug utilities (development only)
import { quickHindiTest } from '../../utils/debugHindiAPI';

// Typing Modal Component - moved outside to prevent re-renders
const TypingModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  customMessage: string;
  onChangeText: (text: string) => void;
  isSpeaking: boolean;
  isLoadingAudio: boolean;
  onSpeak: () => Promise<void>;
  onSave: () => void;
  onClear: () => void;
  onStop: () => void;
  theme: any;
  t: any;
  userPlanId?: string;
  savedModelId?: string;
  onModelChange?: (modelId: string) => Promise<void>;
}> = React.memo(({
  visible,
  onClose,
  customMessage,
  onChangeText,
  isSpeaking,
  isLoadingAudio,
  onSpeak,
  onSave,
  onClear,
  onStop,
  theme,
  t,
  userPlanId,
  savedModelId,
  onModelChange
}) => {
  const styles = makeTypingModalStyles(theme);
  
  // State for cursor position and tags visibility
  const [cursorPosition, setCursorPosition] = React.useState(0);
  const [showTags, setShowTags] = React.useState(false);
  const [showModelInfo, setShowModelInfo] = React.useState(false);
  const inputRef = React.useRef<TextInput>(null);
  
  // Use saved model from database, fallback to default
  const selectedModel = resolveModelId(savedModelId);
  
  // Get character limit based on selected model
  const characterLimit = getCharacterLimit(selectedModel);
  const isPremium = userPlanId ? canUseElevenV3(userPlanId) : false;
  
  // Debug: Log user plan info
  React.useEffect(() => {
    console.log('[TypingModal] User Plan ID:', userPlanId);
    console.log('[TypingModal] Is Premium:', isPremium);
    console.log('[TypingModal] Can use Eleven V3:', canUseElevenV3(userPlanId || ''));
  }, [userPlanId, isPremium]);
  
  // Handle tag insertion (every model supports tags, no model switch needed)
  const handleTagSelect = (tag: EmotionalTag) => {
    // Insert the tag
    const result = insertTagAtPosition(customMessage, tag.value, cursorPosition);
    onChangeText(result.newText);
    setCursorPosition(result.newCursorPosition);
    // Focus back on input
    setTimeout(() => inputRef.current?.focus(), 100);
  };
  
  // Handle model change - save to database
  const handleModelChange = async (modelId: string) => {
    // If text exceeds new model's limit, show warning
    if (customMessage.length > getCharacterLimit(modelId)) {
      Alert.alert(
        t('general.warning') || 'Warning',
        `The ${modelId === VOICE_MODELS.ELEVEN_LABS_PREMIUM ? 'Premium' : 'Standard'} model supports up to ${getCharacterLimit(modelId)} characters. Your text will be truncated.`,
        [{ text: 'OK' }]
      );
    }
    
    // Save to database
    if (onModelChange) {
      await onModelChange(modelId);
    }
  };
  
  // Handle learn more button
  const handleLearnMore = () => {
    setShowModelInfo(true);
  };
  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('aacBoard.customMessage')}</Text>
          <View style={styles.headerSpacer} />
        </View>
        
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <ScrollView 
            style={styles.scrollContent} 
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.content}>
              {/* Model Selector - Show to all users */}
              <ModelSelector
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                theme={theme}
              />
              
              {/* Text Input */}
              <View style={styles.inputContainer}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  placeholder={isSpeaking ? t('general.loading') : t('home.typeMessage')}
                  placeholderTextColor={theme.text + '80'}
                  value={customMessage}
                  onChangeText={onChangeText}
                  onSelectionChange={(event) => {
                    setCursorPosition(event.nativeEvent.selection.start);
                  }}
                  multiline
                  maxLength={characterLimit}
                  editable={!isSpeaking}
                  autoFocus
                  textAlignVertical="top"
                />
                <View style={styles.inputFooter}>
                  <Text style={styles.characterCount}>
                    {customMessage.length}/{characterLimit}
                  </Text>
                  {/* Toggle Tags Button */}
                  <TouchableOpacity
                    onPress={() => setShowTags(!showTags)}
                    style={[styles.tagsToggle, { borderColor: theme.primary }]}
                  >
                    <Text style={{ color: theme.primary }}>
                      🎭 {showTags ? 'Hide' : 'Tags'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {/* Emotional Tags Selector */}
              {showTags && (
                <View style={styles.tagsSection}>
                  <EmotionalTagSelector
                    onTagSelect={handleTagSelect}
                    theme={theme}
                    maxHeight={200}
                    onLearnMore={handleLearnMore}
                    selectedModel={selectedModel}
                  />
                  
                  {/* Emotional Tags Tip */}
                  <View style={[styles.tipBox, { backgroundColor: theme.primary + '15', borderColor: theme.primary }]}>
                    <Text style={[styles.tipText, { color: theme.text }]}>
                      {t('emotionalTags.emotionLimit')}
                    </Text>
                  </View>
                </View>
              )}
              
              {/* Actions */}
              <View style={styles.actions}>
                {customMessage.length > 0 && !isSpeaking && (
                  <>
                    <TouchableOpacity style={styles.actionButton} onPress={onSave}>
                      <Ionicons name="bookmark-outline" size={24} color={theme.primary} />
                      <Text style={styles.actionText}>{t('general.save')}</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.actionButton} onPress={onClear}>
                      <Ionicons name="trash-outline" size={24} color={theme.text + '80'} />
                      <Text style={styles.actionText}>{t('home.clearText')}</Text>
                    </TouchableOpacity>
                  </>
                )}
                
                {isSpeaking && (
                  <TouchableOpacity style={styles.actionButton} onPress={onStop}>
                    <Ionicons name="stop-circle" size={24} color={theme.error || '#EF4444'} />
                    <Text style={styles.actionText}>{t('general.stop')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              {/* Speak Button */}
              <TouchableOpacity
                style={[
                  styles.speakButton,
                  (!customMessage.trim() || isSpeaking) && styles.speakButtonDisabled,
                ]}
                onPress={async () => {
                  await onSpeak();
                  if (!isSpeaking) {
                    onClose();
                  }
                }}
                disabled={!customMessage.trim() || isSpeaking}
              >
                {isLoadingAudio && isSpeaking ? (
                  <ActivityIndicator size="large" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="volume-high" size={32} color="#FFFFFF" />
                    <Text style={styles.speakButtonText}>
                      {t('aacBoard.speak')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      
      {/* Model Info Modal */}
      <ModelInfoModal
        visible={showModelInfo}
        onClose={() => setShowModelInfo(false)}
        theme={theme}
      />
    </Modal>
  );
});

// Typing Modal Styles
const makeTypingModalStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  closeButton: {
    padding: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  keyboardContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  content: {
    padding: 20,
  },
  inputContainer: {
    backgroundColor: theme.card,
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 15,
    padding: 20,
    maxHeight: 300,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 18,
    lineHeight: 24,
    textAlignVertical: 'top',
    minHeight: 80,
    backgroundColor: 'transparent',
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  characterCount: {
    color: theme.text + '80',
    fontSize: 14,
  },
  tagsToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  tagsSection: {
    marginTop: 16,
    marginBottom: 16,
  },
  tipBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
  },
  tipText: {
    fontSize: 12,
    lineHeight: 18,
  },
  scrollContent: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 20,
  },
  actionButton: {
    alignItems: 'center',
    padding: 15,
  },
  actionText: {
    color: theme.text,
    fontSize: 14,
    marginTop: 5,
    fontWeight: '500',
  },
  speakButton: {
    backgroundColor: theme.primary,
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  speakButtonDisabled: {
    backgroundColor: theme.primary + '60',
  },
  speakButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});

// Default categories with icons (used as fallback)
const DEFAULT_CATEGORIES: CategoryUIModel[] = [
  { id: 'basicNeeds', name: 'Basic Needs', icon: 'water-outline', color: '#4F46E5', order: 0, isGlobal: true },
  { id: 'greetings', name: 'Greetings', icon: 'hand-left-outline', color: '#F59E0B', order: 1, isGlobal: true },
  { id: 'feelings', name: 'Feelings', icon: 'happy-outline', color: '#10B981', order: 2, isGlobal: true },
  { id: 'questions', name: 'Questions', icon: 'help-circle-outline', color: '#8B5CF6', order: 3, isGlobal: true },
  { id: 'medical', name: 'Medical', icon: 'medical-outline', color: '#EF4444', order: 4, isGlobal: true },
  { id: 'activities', name: 'Activities', icon: 'bicycle-outline', color: '#EC4899', order: 5, isGlobal: true },
];

// Special "All" category
const ALL_CATEGORY: CategoryUIModel = {
  id: 'all',
  name: 'All Phrases',
  icon: 'grid-outline',
  color: '#64748B', // Slate color
  order: -1,
  isGlobal: true
};

const AACBoardScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { theme } = useContext(ThemeContext);
  const { speak, stopSpeaking, isPlaying: ttsIsPlaying, selectedAudioDevice: hookAudioDevice, forceAudioDevice } = useTextToSpeech();
  const { userSettings, updateVoiceSettings, profileData } = useVoiceSettings();
  const { isAuthenticated, isConnected, streamSpeech } = useDiscord();
  const navigation = useNavigation();
  const { currentStep, isActive: isTutorialActive } = useTutorial();
  
  // Local state for audio device (updated on focus)
  const [currentAudioDevice, setCurrentAudioDevice] = useState<string>(hookAudioDevice);
  
  // Safe area insets for proper layout handling
  const insets = useSafeAreaInsets();
  
  // Update audio device display when screen gains focus
  useFocusEffect(
    React.useCallback(() => {
      const loadAudioDevice = async () => {
        try {
          const savedDevice = await AsyncStorage.getItem('selectedAudioDevice');
          if (savedDevice) {
            setCurrentAudioDevice(savedDevice);
          }
        } catch (error) {
          console.error('Failed to load audio device:', error);
        }
      };
      loadAudioDevice();
    }, [])
  );
  
  // Current language from i18n
  const currentLanguage = i18n.language || 'en';
  
  // Orientation state for responsive design
  const [orientation, setOrientation] = useState(
    Dimensions.get('window').width > Dimensions.get('window').height ? 'landscape' : 'portrait'
  );
  
  // Listen for orientation changes
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const newOrientation = window.width > window.height ? 'landscape' : 'portrait';
      if (newOrientation !== orientation) {
        setOrientation(newOrientation);
      }
    });

    return () => subscription?.remove();
  }, [orientation]);
  
  // Add state for tracking language fallback
  const [languageFallbackUsed, setLanguageFallbackUsed] = useState(false);
  const [originalLanguage, setOriginalLanguage] = useState<string | null>(null);

  // Collapsible sections state
  const [isRecentPhrasesCollapsed, setIsRecentPhrasesCollapsed] = useState(false);
  
  // Animation values for smooth transitions
  const [recentPhrasesAnimation] = useState(new Animated.Value(1));

  // State
  const [categories, setCategories] = useState<CategoryUIModel[]>([ALL_CATEGORY, ...DEFAULT_CATEGORIES]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [customMessage, setCustomMessage] = useState('');
  const [recentPhrases, setRecentPhrases] = useState<SentenceUIModel[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [phrases, setPhrases] = useState<Record<string, SentenceUIModel[]>>({});
  const [allPhrases, setAllPhrases] = useState<SentenceUIModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCategoriesLoading, setCategoriesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentlyPlayingText, setCurrentlyPlayingText] = useState<string | null>(null);
  
  // Track subscription limit status
  const [subscriptionLimitReached, setSubscriptionLimitReached] = useState(false);
  const [creditLimitModalVisible, setCreditLimitModalVisible] = useState(false);
  
  // Check if user has premium access for v3 model
  const userPlanId = profileData?.subscription?.tier;
  const hasPremiumAccess = userPlanId ? canUseElevenV3(userPlanId) : false;
  const currentModelId = resolveModelId(userSettings?.voiceSettings?.modelId);
  
  // Modal state
  const [sentenceFormVisible, setSentenceFormVisible] = useState(false);
  const [modelSelectorVisible, setModelSelectorVisible] = useState(false);
  const [modelInfoVisible, setModelInfoVisible] = useState(false);
  const [editingSentence, setEditingSentence] = useState<SentenceUIModel | undefined>(undefined);
  const [categoryFormVisible, setCategoryFormVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryUIModel | undefined>(undefined);
  const [typingModalVisible, setTypingModalVisible] = useState(false);

  // Add state for Discord streaming
  const [isStreamingToDiscord, setIsStreamingToDiscord] = useState(false);

  // Reorder mode state
  const [reorderModeVisible, setReorderModeVisible] = useState(false);
  const [reorderCategoryId, setReorderCategoryId] = useState<string>('');

  // AAC Preferences state
  const [aacPreferences, setAacPreferences] = useState<AACPreferences | null>(null);

  const styles = makeStyles(theme);

  // Collapsible section toggle function for recent phrases only
  const toggleRecentPhrases = () => {
    const toValue = isRecentPhrasesCollapsed ? 1 : 0;  // If currently collapsed, expand (1), if expanded, collapse (0)
    setIsRecentPhrasesCollapsed(!isRecentPhrasesCollapsed);
    
    Animated.timing(recentPhrasesAnimation, {
      toValue,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  // Use effect to update isSpeaking state based on TTS service state
  useEffect(() => {
    if (!ttsIsPlaying && !isLoadingAudio && isSpeaking) {
      // TTS has stopped playing, update our state
      setIsSpeaking(false);
      setCurrentlyPlayingText(null);
    }
  }, [ttsIsPlaying, isLoadingAudio, isSpeaking]);

  // Auto-select "Basic Needs" category during tutorial
  useEffect(() => {
    if (isTutorialActive && currentStep?.id === 'selectCategory' && categories.length > 0) {
      // Find the "Basic Needs" category (check both English and localized names)
      const basicNeedsCategory = categories.find(cat => 
        cat.id === 'basic-needs' || 
        cat.name.toLowerCase().includes('basic') ||
        cat.name.toLowerCase().includes('essentiels') // French
      );
      
      if (basicNeedsCategory && selectedCategory !== basicNeedsCategory.id) {
        console.log('[AACBoard] Tutorial: Auto-selecting Basic Needs category');
        setTimeout(() => {
          setSelectedCategory(basicNeedsCategory.id);
        }, 500);
      }
    }
  }, [isTutorialActive, currentStep, categories, selectedCategory]);

  // Fetch AAC preferences - refetch on screen focus
  useFocusEffect(
    React.useCallback(() => {
      const fetchPreferences = async () => {
        try {
          const prefs = await aacService.getPreferences();
          setAacPreferences(prefs);
        } catch (error) {
          console.error('[AACBoard] Error fetching AAC preferences:', error);
        }
      };

      fetchPreferences();
    }, [])
  );

  // Clear phrases cache when language changes to prevent showing old language data
  useEffect(() => {
    console.log('[AACBoard] Language changed to:', currentLanguage, '- clearing phrases cache');
    setPhrases({});
    setAllPhrases([]);
  }, [currentLanguage]);

  // Fetch categories from API
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setCategoriesLoading(true);
        setError(null);
        setLanguageFallbackUsed(false);
        setOriginalLanguage(null);
        
        // Debug log
        console.log('[AACBoard] fetchCategories - using language:', currentLanguage);
        
        // Fetch from API
        const apiCategories = await aacService.getCategories(currentLanguage);
        
        console.log('[AACBoard] fetchCategories - received categories:', apiCategories.length);
        
        if (apiCategories.length > 0) {
          // Map to UI model and sort by order
          const uiCategories = apiCategories
            .map(mapToUICategoryModel)
            .sort((a, b) => a.order - b.order);
          
          // Add the "All" category at the beginning
          setCategories([ALL_CATEGORY, ...uiCategories]);
          
          // Select "All" category by default
          if (!selectedCategory) {
            setSelectedCategory('all');
          }
          
          // Check if we received English data when requesting Hindi
          const hasHindiSpecificData = apiCategories.some(cat => 
            cat.language === currentLanguage || 
            (currentLanguage === 'hi' && cat.language === 'hi')
          );
          
          if (currentLanguage === 'hi' && !hasHindiSpecificData) {
            console.warn('[AACBoard] Received categories but none are Hindi-specific. Likely using fallback data.');
            setLanguageFallbackUsed(true);
            setOriginalLanguage('hi');
          }
        } else {
          // Fallback to defaults if no categories found
          console.log('[AACBoard] No categories found for language:', currentLanguage, '- using defaults');
          setCategories([ALL_CATEGORY, ...DEFAULT_CATEGORIES]);
          
          // Set fallback state for Hindi
          if (currentLanguage === 'hi') {
            setLanguageFallbackUsed(true);
            setOriginalLanguage('hi');
          }
        }
      } catch (err) {
        console.error('Error fetching categories:', err);
        
        // Enhanced error handling for Hindi
        if (currentLanguage === 'hi') {
          console.error('[AACBoard] Hindi categories fetch failed. Error details:', {
            error: err,
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
            currentLanguage,
            timestamp: new Date().toISOString()
          });
          
          setLanguageFallbackUsed(true);
          setOriginalLanguage('hi');
        }
        
        // Fallback to defaults on error
        setCategories([ALL_CATEGORY, ...DEFAULT_CATEGORIES]);
      } finally {
        setCategoriesLoading(false);
      }
    };
    
    fetchCategories();
  }, [currentLanguage]);

  // Fetch all sentences when "all" category is selected or when categories change
  useEffect(() => {
    const fetchAllSentences = async () => {
      if (selectedCategory !== 'all') return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Debug log
        console.log('[AACBoard] fetchAllSentences - using language:', currentLanguage);
        
        // Fetch all sentences without categoryId filter
        const apiSentences = await aacService.getSentences(undefined, currentLanguage);
        
        console.log('[AACBoard] fetchAllSentences - received sentences:', apiSentences.length);
        
        // Deduplicate sentences to avoid showing both default and user's custom versions
        let deduplicatedSentences = deduplicateSentences(apiSentences);
        
        console.log('[AACBoard] fetchAllSentences - after deduplication:', deduplicatedSentences.length, 
          'removed:', apiSentences.length - deduplicatedSentences.length, 'duplicates');
        
        // Filter out default sentences if user preference is set
        if (aacPreferences?.hideDefaultSentences) {
          deduplicatedSentences = deduplicatedSentences.filter(s => !s.isGlobal);
          console.log('[AACBoard] fetchAllSentences - after filtering defaults:', deduplicatedSentences.length);
        }
        
        // Check if we received Hindi-specific data
        if (currentLanguage === 'hi') {
          const hasHindiSpecificSentences = deduplicatedSentences.some(sentence => 
            sentence.language === 'hi'
          );
          
          if (!hasHindiSpecificSentences && deduplicatedSentences.length > 0) {
            console.warn('[AACBoard] Received sentences but none are Hindi-specific. Likely using fallback data.');
            setLanguageFallbackUsed(true);
            setOriginalLanguage('hi');
          } else if (deduplicatedSentences.length === 0) {
            console.warn('[AACBoard] No sentences found for Hindi at all.');
            setLanguageFallbackUsed(true);
            setOriginalLanguage('hi');
          }
        }
        
        // Map to UI model
        const uiSentences = deduplicatedSentences
          .map(mapToUISentenceModel)
          .sort((a, b) => {
            // Sort by category and then by order/id
            const catA = categories.find(c => c.id === a.categoryId)?.order || 0;
            const catB = categories.find(c => c.id === b.categoryId)?.order || 0;
            if (catA !== catB) return catA - catB;
            
            // For sentences in the same category, sort by their original order if available
            const itemA = deduplicatedSentences.find(s => s.id === a.id);
            const itemB = deduplicatedSentences.find(s => s.id === b.id);
            return (itemA?.order || 0) - (itemB?.order || 0);
          });
        
        setAllPhrases(uiSentences);
      } catch (err) {
        console.error('Error fetching all sentences:', err);
        
        // Enhanced error handling for Hindi
        if (currentLanguage === 'hi') {
          console.error('[AACBoard] Hindi sentences fetch failed. Error details:', {
            error: err,
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
            currentLanguage,
            selectedCategory,
            timestamp: new Date().toISOString()
          });
        }
        
        setError('Failed to load phrases');
        setAllPhrases([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchAllSentences();
  }, [selectedCategory, currentLanguage, categories, aacPreferences]);

  // Fetch sentences for specific category
  useEffect(() => {
    const fetchSentences = async () => {
      if (!selectedCategory || selectedCategory === 'all') return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Debug log
        console.log('[AACBoard] fetchSentences - using language:', currentLanguage, 'category:', selectedCategory);
        
        // Fetch from API
        const apiSentences = await aacService.getSentences(selectedCategory, currentLanguage);
        
        console.log('[AACBoard] fetchSentences - received sentences for category:', apiSentences.length);
        
        // Deduplicate sentences to avoid showing both default and user's custom versions
        let deduplicatedSentences = deduplicateSentences(apiSentences);
        
        console.log('[AACBoard] fetchSentences - after deduplication for category', selectedCategory + ':', 
          deduplicatedSentences.length, 'removed:', apiSentences.length - deduplicatedSentences.length, 'duplicates');
        
        // Filter out default sentences if user preference is set
        if (aacPreferences?.hideDefaultSentences) {
          deduplicatedSentences = deduplicatedSentences.filter(s => !s.isGlobal);
          console.log('[AACBoard] fetchSentences - after filtering defaults:', deduplicatedSentences.length);
        }
        
        // Map to UI model and sort by order
        const uiSentences = deduplicatedSentences
          .map(mapToUISentenceModel)
          .sort((a, b) => {
            const itemA = deduplicatedSentences.find(s => s.id === a.id);
            const itemB = deduplicatedSentences.find(s => s.id === b.id);
            return (itemA?.order || 0) - (itemB?.order || 0);
          });
        
        // Update phrases for the selected category
        setPhrases(prev => ({
          ...prev,
          [selectedCategory]: uiSentences
        }));
      } catch (err) {
        console.error('Error fetching sentences:', err);
        setError('Failed to load phrases');
        
        // Clear phrases for this category on error
        setPhrases(prev => ({
          ...prev,
          [selectedCategory]: []
        }));
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchSentences();
  }, [selectedCategory, currentLanguage, aacPreferences]);

  const speakPhrase = async (text: string, phraseId?: string) => {
    try {
      if (isSpeaking) {
        handleStopSpeaking();
        return;
      }
      
      // Don't speak empty text
      if (!text.trim()) {
        return;
      }
      
      // Check if we've reached the subscription limit
      if (subscriptionLimitReached) {
        Alert.alert(
          t('general.subscriptionRequired'),
          t('aac.subscriptionLimitReachedMessage'),
          [
            {
              text: t('general.upgrade'),
              onPress: () => handleSubscriptionUpgrade(),
            },
            {
              text: t('general.cancel'),
              style: 'cancel',
            },
          ]
        );
        return;
      }
      
      // Log for debugging
      console.log('[AACBoard] Speaking phrase:', text);
      
      // Set state to indicate speaking has started
      setIsSpeaking(true);
      setIsLoadingAudio(true);
      setCurrentlyPlayingText(text);
      
      // Update recent phrases (add to the beginning, keep only last 5)
      if (phraseId) {
        const sentenceToAdd = allPhrases.find(p => p.id === phraseId);
        if (sentenceToAdd) {
          // Only add if not already in the list or not at the top
          if (!recentPhrases.find(p => p.id === sentenceToAdd.id)) {
            setRecentPhrases([sentenceToAdd, ...recentPhrases.slice(0, 4)]);
          } else if (recentPhrases[0].id !== sentenceToAdd.id) {
            // Move to top if already in list but not at top
            setRecentPhrases([
              sentenceToAdd,
              ...recentPhrases.filter(p => p.id !== sentenceToAdd.id).slice(0, 4)
            ]);
          }
        }
      }
      
      // Stream to Discord if connected
      if (isConnected) {
        setIsStreamingToDiscord(true);
        try {
          // Show streaming indicator
          console.log('[AACBoard] Streaming to Discord:', text);
          
          // Start streaming to Discord - don't await this to avoid blocking the speech
          // The direct streaming API will handle this independently
          streamSpeech(text).catch(err => {
            console.log('[AACBoard] Discord streaming error (not critical):', err);
            // Non-critical error, no need to show to the user
          });
        } catch (discordError) {
          // This should never happen since we're catching errors in the streamSpeech call
          console.log('[AACBoard] Discord streaming catch block (should not occur):', discordError);
          // Continue with normal speech even if Discord streaming fails
        } finally {
          // Short delay before hiding the streaming indicator
          setTimeout(() => {
            setIsStreamingToDiscord(false);
          }, 1000); // Short delay to show the indicator
        }
      }
      
      // Use TTS service to speak
      await speak(text, undefined, undefined, currentLanguage);
      
      // Increment usage count for the sentence if it has an ID
      if (phraseId) {
        try {
          await aacService.incrementSentenceUsage(phraseId);
        } catch (err) {
          console.error('Failed to increment sentence usage:', err);
          // Non-critical error, don't show to user
        }
      }
    } catch (err: any) {
      console.error('Error speaking phrase:', err);
      
      // Check for credit limit error (429 status or LIMIT_EXCEEDED code)
      const errorMessage = err?.message || '';
      const isLimitError = 
        errorMessage.includes('LIMIT_EXCEEDED') || 
        errorMessage.includes('429') || 
        errorMessage.includes('limit') ||
        err?.status === 429;
      
      if (isLimitError) {
        console.log('[AACBoard] Credit limit reached, showing upgrade modal');
        setSubscriptionLimitReached(true);
        setCreditLimitModalVisible(true);
      } else {
        setError('Failed to speak phrase');
      }
      
      setIsSpeaking(false);
      setCurrentlyPlayingText(null);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const handleStopSpeaking = () => {
    stopSpeaking();
    Speech.stop();
    setIsSpeaking(false);
    setIsLoadingAudio(false);
    setCurrentlyPlayingText(null);
  };

  const handleSubscriptionUpgrade = () => {
    // Navigate to subscription page or open a web link
    const lang = i18n.language || 'en';
    const url = `https://speech-aac.link/${lang}/profile?upgrade=true`;
    Linking.openURL(url).catch(err => {
      console.error('Failed to open upgrade URL:', err);
    });
  };

  // Handler for saving model selection to database
  const handleModelChange = useCallback(async (modelId: string) => {
    try {
      // Partial update: only send the modelId field
      // Backend will update only this field for existing settings
      await updateVoiceSettings({
        modelId
      } as any);
      console.log('[AACBoard] Model saved to database:', modelId);
      
      // Note: Modal closing and success message is handled by ModelSelectionModal component
    } catch (error) {
      console.error('[AACBoard] Failed to save model selection:', error);
      throw error; // Let the modal handle the error display
    }
  }, [updateVoiceSettings]);

  const speakCustomMessage = async () => {
    if (customMessage.trim()) {
      try {
        // Don't continue if we're already speaking
        if (isSpeaking) {
          handleStopSpeaking();
          return;
        }
        
        // Check subscription limit
        if (subscriptionLimitReached) {
          Alert.alert(
            t('general.subscriptionRequired'),
            t('aac.subscriptionLimitReachedMessage'),
            [
              {
                text: t('general.upgrade'),
                onPress: () => handleSubscriptionUpgrade(),
              },
              {
                text: t('general.cancel'),
                style: 'cancel',
              },
            ]
          );
          return;
        }
        
        // Create a temporary SentenceUIModel for the custom message
        const customSentence: SentenceUIModel = {
          id: `custom-${Date.now()}`,
          text: customMessage.trim(),
          categoryId: 'custom', // Use a special category ID for custom messages
          isFavorite: false
        };
        
        // Update recent phrases (add to beginning, keep only last 5)
        if (!recentPhrases.find(p => p.text === customMessage.trim())) {
          setRecentPhrases([customSentence, ...recentPhrases.slice(0, 4)]);
        }
        
        // Set state to indicate speaking has started
        setIsSpeaking(true);
        setIsLoadingAudio(true);
        setCurrentlyPlayingText(customMessage.trim());
        
        // Stream to Discord if connected
        if (isConnected) {
          setIsStreamingToDiscord(true);
          try {
            console.log('[AACBoard] Streaming custom message to Discord:', customMessage);
            streamSpeech(customMessage).catch(err => {
              console.log('[AACBoard] Discord streaming error (not critical):', err);
            });
          } catch (discordError) {
            console.log('[AACBoard] Discord streaming catch block (should not occur):', discordError);
          } finally {
            setTimeout(() => {
              setIsStreamingToDiscord(false);
            }, 1000);
          }
        }
        
        // Get saved modelId from user settings (with fallback)
        const savedModelId = userSettings?.voiceSettings?.modelId;
        
        // Speak the message directly with modelId in settings
        await speak(customMessage, undefined, undefined, currentLanguage);
        
        // Clear the input
        setCustomMessage('');
      } catch (err: any) {
        console.error('Error speaking custom message:', err);
        
        // Check for credit limit error (429 status or LIMIT_EXCEEDED code)
        const errorMessage = err?.message || '';
        const isLimitError = 
          errorMessage.includes('LIMIT_EXCEEDED') || 
          errorMessage.includes('429') || 
          errorMessage.includes('limit') ||
          err?.status === 429;
        
        if (isLimitError) {
          console.log('[AACBoard] Credit limit reached, showing upgrade modal');
          setSubscriptionLimitReached(true);
          setCreditLimitModalVisible(true);
        } else {
          setError('Failed to speak custom message');
        }
        
        setIsSpeaking(false);
        setCurrentlyPlayingText(null);
      } finally {
        setIsLoadingAudio(false);
      }
    }
  };

  const handleAddPhrase = () => {
    // Create a new sentence with pre-filled text if customMessage is set
    if (customMessage.trim()) {
      const newSentence: SentenceUIModel = {
        id: '', // Empty ID indicates it's a new sentence
        text: customMessage.trim(),
        categoryId: categories.find(c => c.id !== 'all')?.id || '', // Default to first real category
        isFavorite: false
      };
      setEditingSentence(newSentence);
    } else {
      setEditingSentence(undefined);
    }
    setSentenceFormVisible(true);
  };
  
  const handleAddPhraseWithText = (prefillText: string) => {
    const newSentence: SentenceUIModel = {
      id: '', // Empty ID indicates it's a new sentence
      text: prefillText,
      categoryId: categories.find(c => c.id !== 'all')?.id || '', // Default to first real category
      isFavorite: false
    };
    setEditingSentence(newSentence);
    setSentenceFormVisible(true);
  };
  
  const handleEditPhrase = (sentence: SentenceUIModel) => {
    setEditingSentence(sentence);
    setSentenceFormVisible(true);
  };
  
  const handleDeletePhrase = (sentence: SentenceUIModel) => {
    Alert.alert(
      t('aacBoard.deletePhrase'),
      t('aacBoard.deleteConfirm'),
      [
        {
          text: t('general.cancel'),
          style: 'cancel'
        },
        {
          text: t('general.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await aacService.deleteSentence(sentence.id);
              
              // Update local state
              setPhrases(prev => {
                const categoryPhrases = [...(prev[sentence.categoryId] || [])];
                const updatedPhrases = categoryPhrases.filter(p => p.id !== sentence.id);
                
                return {
                  ...prev,
                  [sentence.categoryId]: updatedPhrases
                };
              });
              
              // Also remove from recent phrases if present
              setRecentPhrases(prev => prev.filter(p => p.id !== sentence.id));
              
            } catch (error) {
              console.error('Error deleting phrase:', error);
              Alert.alert(
                t('general.error.title'),
                t('aacBoard.errorDeletingPhrase')
              );
            }
          }
        }
      ]
    );
  };
  
  const handleSaveSentence = (sentence: SentenceUIModel) => {
    // Update local state with the new/updated sentence
    setPhrases(prev => {
      const categoryPhrases = [...(prev[sentence.categoryId] || [])];
      
      // Check if this is an update or a new sentence
      const existingIndex = sentence.id ? categoryPhrases.findIndex(p => p.id === sentence.id) : -1;
      
      if (existingIndex >= 0) {
        // Update existing sentence
        categoryPhrases[existingIndex] = sentence;
      } else {
        // Add new sentence
        categoryPhrases.push(sentence);
      }
      
      return {
        ...prev,
        [sentence.categoryId]: categoryPhrases
      };
    });
    
    // If we're currently viewing the category this sentence belongs to,
    // make sure the UI updates (not strictly necessary with the above code,
    // but added for clarity)
    if (selectedCategory === sentence.categoryId) {
      setSelectedCategory(prev => {
        // This trick forces a re-render without actually changing the state
        const temp = '';
        setTimeout(() => setSelectedCategory(prev), 10);
        return temp;
      });
    }
    
    // Clear the custom message after saving
    setCustomMessage('');
  };

  const handleOpenReorderMode = (categoryId: string) => {
    setReorderCategoryId(categoryId);
    setReorderModeVisible(true);
  };

  const handleSaveReorder = async (reorderedSentences: SentenceUIModel[]) => {
    try {
      // Prepare the reorder request
      const items = reorderedSentences.map((sentence, index) => ({
        id: sentence.id,
        order: index,
      }));

      // Call the API to save the new order
      await aacService.reorderSentences({
        categoryId: reorderCategoryId,
        items,
      });

      // Update local state
      setPhrases(prev => ({
        ...prev,
        [reorderCategoryId]: reorderedSentences,
      }));

      // Close the modal
      setReorderModeVisible(false);
      setReorderCategoryId('');
    } catch (error) {
      console.error('Error saving sentence order:', error);
      throw error; // Re-throw to let the modal handle the error display
    }
  };

  const handleAddCategory = () => {
    setEditingCategory(undefined);
    setCategoryFormVisible(true);
  };
  
  const handleEditCategory = (category: CategoryUIModel) => {
    setEditingCategory(category);
    setCategoryFormVisible(true);
  };
  
  const handleDeleteCategory = (category: CategoryUIModel) => {
    // Don't allow deleting if it has phrases
    const hasPhrases = phrases[category.id] && phrases[category.id].length > 0;
    
    if (hasPhrases) {
      Alert.alert(
        t('aacBoard.cannotDeleteCategory'),
        t('aacBoard.categoryHasPhrases'),
        [{ text: t('general.ok') }]
      );
      return;
    }
    
    Alert.alert(
      t('aacBoard.deleteCategory'),
      t('aacBoard.deleteCategoryConfirm'),
      [
        {
          text: t('general.cancel'),
          style: 'cancel'
        },
        {
          text: t('general.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await aacService.deleteCategory(category.id);
              
              // Update local state
              setCategories(prev => prev.filter(c => c.id !== category.id));
              
              // If we're currently viewing this category, switch to another one
              if (selectedCategory === category.id) {
                const remainingCategories = categories.filter(c => c.id !== category.id);
                if (remainingCategories.length > 0) {
                  setSelectedCategory(remainingCategories[0].id);
                } else {
                  setSelectedCategory('');
                }
              }
              
            } catch (error) {
              console.error('Error deleting category:', error);
              Alert.alert(
                t('general.error.title'),
                t('aacBoard.errorDeletingCategory')
              );
            }
          }
        }
      ]
    );
  };
  
  const handleSaveCategory = (category: CategoryUIModel) => {
    // Update local state with the new/updated category
    setCategories(prev => {
      const existingIndex = prev.findIndex(c => c.id === category.id);
      
      if (existingIndex >= 0) {
        // Update existing category
        const updatedCategories = [...prev];
        updatedCategories[existingIndex] = category;
        return updatedCategories;
      } else {
        // Add new category
        return [...prev, category].sort((a, b) => a.order - b.order);
      }
    });
  };
  
  const handleCategoryLongPress = (category: CategoryUIModel) => {
    // Don't allow editing global categories
    if (category.isGlobal) {
      Alert.alert(
        t('aacBoard.cannotModifyCategory'),
        t('aacBoard.globalCategoryInfo'),
        [{ text: t('general.ok') }]
      );
      return;
    }
    
    Alert.alert(
      category.name,
      t('aacBoard.selectCategoryAction'),
      [
        {
          text: t('general.cancel'),
          style: 'cancel'
        },
        {
          text: t('general.edit'),
          onPress: () => handleEditCategory(category)
        },
        {
          text: t('general.delete'),
          style: 'destructive',
          onPress: () => handleDeleteCategory(category)
        }
      ]
    );
  };

  const renderCategoryItem = ({ item }: { item: CategoryUIModel }) => (
    <TouchableOpacity
      style={[
        orientation === 'landscape' ? styles.categoryButtonLandscape : styles.categoryButton,
        selectedCategory === item.id && (orientation === 'landscape' ? styles.selectedCategoryButtonLandscape : styles.selectedCategoryButton),
        { backgroundColor: selectedCategory === item.id ? item.color : theme.card }
      ]}
      onPress={() => setSelectedCategory(item.id)}
      onLongPress={() => handleCategoryLongPress(item)}
    >
      <Ionicons
        name={item.icon as any}
        size={orientation === 'landscape' ? 16 : 28}
        color={selectedCategory === item.id ? '#FFFFFF' : theme.text}
      />
      <Text
        style={[
          orientation === 'landscape' ? styles.categoryTextLandscape : styles.categoryText,
          selectedCategory === item.id && styles.selectedCategoryText,
        ]}
        numberOfLines={orientation === 'landscape' ? 2 : 1}
      >
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  const renderPhraseItem = ({ item }: { item: SentenceUIModel }) => {
    // Get category for this sentence to fallback to category color/icon
    const category = categories.find(c => c.id === item.categoryId);
    
    // Only use custom icon if explicitly set, don't fallback to category icon
    const displayIcon = item.icon;
    const displayIconType = item.iconType || 'ionicon';
    
    // Get the base color (custom or category)
    const baseColor = item.color || category?.color || theme.primary;
    
    // Make the color much lighter (more pale) for better text readability
    // Convert hex to RGB, then add opacity to make it very light
    const lightenColor = (hexColor: string) => {
      // Remove # if present
      const hex = hexColor.replace('#', '');
      // Convert to RGB
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      // Return with very low opacity to make it pale
      return `rgba(${r}, ${g}, ${b}, 0.15)`;
    };
    
    const displayColor = lightenColor(baseColor);
    const accentColor = baseColor; // Use full color for icon

    return (
      <TouchableOpacity
        style={[
          orientation === 'landscape' ? styles.phraseButtonLandscape : styles.phraseButton,
          { 
            backgroundColor: displayColor,
            borderLeftWidth: 3,
            borderLeftColor: accentColor,
          },
          currentlyPlayingText === item.text && (orientation === 'landscape' ? styles.playingPhraseButtonLandscape : styles.playingPhraseButton)
        ]}
        onPress={() => speakPhrase(item.text, item.id)}
        onLongPress={() => handlePhraseActions(item)}
      >
        {displayIcon && (
          <View style={styles.phraseIconContainer}>
            {displayIconType === 'emoji' ? (
              <Text style={styles.phraseEmoji}>{displayIcon}</Text>
            ) : (
              <Ionicons name={displayIcon as any} size={20} color={accentColor} />
            )}
          </View>
        )}
        <Text 
          style={[
            orientation === 'landscape' ? styles.phraseTextLandscape : styles.phraseText
          ]} 
          numberOfLines={orientation === 'landscape' ? 2 : 3}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {item.text}
        </Text>
        {currentlyPlayingText === item.text && (
          <View style={styles.playingIndicatorContainer}>
            {isLoadingAudio ? (
              <ActivityIndicator size="small" color={accentColor} />
            ) : (
              <TouchableOpacity
                style={styles.stopButton}
                onPress={handleStopSpeaking}
              >
                <Ionicons name="stop" size={12} color={accentColor} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };
  
  const handlePhraseActions = (sentence: SentenceUIModel) => {
    // Check if this is a custom message (ID starts with "custom-")
    const isCustomMessage = sentence.id.startsWith('custom-');
    
    if (isCustomMessage) {
      // For custom messages, offer speak and save options
      Alert.alert(
        sentence.text,
        t('aacBoard.customMessage'),
        [
          {
            text: t('general.cancel'),
            style: 'cancel'
          },
          {
            text: t('aacBoard.speak'),
            onPress: () => speakPhrase(sentence.text, sentence.id)
          },
          {
            text: t('general.save'),
            onPress: () => {
              // Use handleAddPhraseWithText to open the add form with pre-filled text
              handleAddPhraseWithText(sentence.text);
            }
          }
        ]
      );
      return;
    }
    
    // For regular phrases, show all options
    Alert.alert(
      sentence.text,
      t('aacBoard.selectAction'),
      [
        {
          text: t('general.cancel'),
          style: 'cancel'
        },
        {
          text: t('aac.phrases.edit'),
          onPress: () => handleEditPhrase(sentence)
        },
        {
          text: t('aac.phrases.delete'),
          style: 'destructive',
          onPress: () => handleDeletePhrase(sentence)
        }
      ]
    );
  };

  // Render empty state when no phrases are found
  const renderEmptyPhrases = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.emptyText}>{t('general.loading')}</Text>
        </View>
      );
    }
    
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={40} color={theme.text} />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={() => {
              // Re-fetch sentences for this category
              setSelectedCategory(prevCat => {
                // Toggle state to trigger re-fetch
                const temp = '';
                setTimeout(() => setSelectedCategory(prevCat), 10);
                return temp;
              });
            }}
          >
            <Text style={styles.retryText}>{t('general.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="chatbubble-outline" size={40} color={theme.text} />
        <Text style={styles.emptyText}>{t('aacBoard.noPhrases')}</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddPhrase}>
          <Ionicons name="add-outline" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>{t('aac.phrases.add')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView 
      style={styles.container}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.contentContainer}>
          <ScreenHeader
            title={""}
            rightComponent={
              <View style={styles.headerActions}>
                  {/* Model Selector - Only show for premium users */}
                  {hasPremiumAccess && (
                  <TouchableOpacity 
                    style={[styles.headerButton, styles.modelSelectorButton]} 
                    onPress={() => setModelSelectorVisible(true)}
                  >
                    <View style={styles.modelIconContainer}>
                      <Ionicons 
                        name={currentModelId === VOICE_MODELS.ELEVEN_LABS_PREMIUM ? 'sparkles' : 'flash'} 
                        size={24} 
                        color={theme.primary} 
                      />
                      <View style={[styles.modelBadge, { backgroundColor: currentModelId === VOICE_MODELS.ELEVEN_LABS_PREMIUM ? '#FFD700' : theme.primary }]}>
                        <Text style={styles.modelBadgeText}>
                          {currentModelId === VOICE_MODELS.ELEVEN_LABS_PREMIUM ? 'v3' : 'v4'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
                <TouchableOpacity 
                  style={styles.headerButton} 
                  onPress={async () => {
                    try {
                      await forceAudioDevice();
                      Alert.alert(
                        t('audioOutput.success') || 'Success',
                        t('audioOutput.deviceForced') || `Audio forced to ${currentAudioDevice}`
                      );
                    } catch (error) {
                      Alert.alert(
                        t('general.error') || 'Error',
                        t('audioOutput.forceFailed') || 'Failed to force audio device'
                      );
                    }
                  }}
                  onLongPress={() => {
                    navigation.navigate('AudioOutputSettings' as never);
                  }}
                >
                  <Ionicons 
                    name={currentAudioDevice === 'speaker' ? 'volume-high' : currentAudioDevice === 'bluetooth' ? 'bluetooth' : 'headset'} 
                    size={24} 
                    color={theme.primary} 
                  />
                </TouchableOpacity>
              
                <TutorialTarget id="aac-category-selector">
                  <TouchableOpacity style={styles.headerButton} onPress={handleAddCategory}>
                    <Ionicons name="folder-outline" size={24} color={theme.primary} />
                  </TouchableOpacity>
                </TutorialTarget>
                <TutorialTarget id="aac-add-sentence-button">
                  <TouchableOpacity style={styles.headerButton} onPress={handleAddPhrase}>
                    <Ionicons name="add-outline" size={24} color={theme.primary} />
                  </TouchableOpacity>
                </TutorialTarget>
                {/* Reorder button - only show when viewing a specific category */}
                {selectedCategory && selectedCategory !== 'all' && (
                  <TutorialTarget id="aac-reorder-button">
                    <TouchableOpacity 
                      style={styles.headerButton} 
                      onPress={() => handleOpenReorderMode(selectedCategory)}
                    >
                      <Ionicons name="swap-vertical-outline" size={24} color={theme.primary} />
                    </TouchableOpacity>
                  </TutorialTarget>
                )}
                
                {isAuthenticated && (
                  <DiscordIndicator 
                    size="medium" 
                    showLabel={isConnected}
                    isStreaming={isStreamingToDiscord} 
                  />
                )}
              </View>
            }
          />          
          {subscriptionLimitReached && (
            <TouchableOpacity 
              style={styles.limitBanner} 
              onPress={() => {
                // Open the profile page to upgrade
                // For development, link to local profile, for production, link to website
                const upgradeUrl = __DEV__ 
                  ? '/profile?upgrade=true' 
                  : 'https://speech-aac.link/en/profile?upgrade=true';
                
                // You'd need to implement navigation to the profile page here
                // For example, using Linking.openURL for the website version:
                // Linking.openURL(upgradeUrl);
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
                        // Implementation depends on your navigation setup
                        // This is a placeholder - replace with actual navigation
                        const url = 'https://speech-aac.link/en/profile?upgrade=true';
                        Linking.openURL(url).catch(err => {
                          console.error('Failed to open upgrade URL:', err);
                          Alert.alert(t('general.error.title'), t('general.couldNotOpenBrowser'));
                        });
                      }
                    }
                  ]
                );
              }}
            >
              <View style={styles.limitBannerContent}>
                <Ionicons name="warning-outline" size={20} color="#FFFFFF" />
                <Text style={styles.limitBannerText}>
                  {t('subscription.limitReached', 'Subscription limit reached. Upgrade for more.')}
                </Text>
                <View style={styles.limitBannerButton}>
                  <Text style={styles.limitBannerButtonText}>
                    {t('subscription.upgrade', 'Upgrade')}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          
          {languageFallbackUsed && originalLanguage === 'hi' && (
            <View style={styles.fallbackBanner}>
              <View style={styles.fallbackBannerContent}>
                <Ionicons name="information-circle-outline" size={20} color="#4F46E5" />
                <Text style={styles.fallbackBannerText}>
                  {t('aacBoard.hindiDataNotAvailable', 'Hindi content is being prepared. English content is shown temporarily.')}
                </Text>
                <TouchableOpacity
                  style={styles.fallbackBannerButton}
                  onPress={() => setLanguageFallbackUsed(false)}
                >
                  <Ionicons name="close" size={16} color="#4F46E5" />
                </TouchableOpacity>
              </View>
            </View>
          )}
          
          <View style={styles.mainContent}>
            <View style={styles.contentArea}>
              {orientation === 'landscape' ? (
                // Landscape layout: horizontal split with categories on left
                <View style={styles.landscapeContainer}>
                  <View style={styles.landscapeLeft}>
                    <View style={styles.categoriesContainerLandscape}>
                      {isCategoriesLoading ? (
                        <View style={styles.loadingCategories}>
                          <ActivityIndicator size="small" color={theme.primary} />
                        </View>
                      ) : (
                        <ScrollView 
                          showsVerticalScrollIndicator={true}
                          contentContainerStyle={styles.categoriesListLandscape}
                          nestedScrollEnabled={true}
                        >
                          {categories.map((item) => (
                            <View key={item.id}>
                              {renderCategoryItem({ item })}
                            </View>
                          ))}
                          <TouchableOpacity
                            style={styles.addCategoryButtonLandscape}
                            onPress={handleAddCategory}
                          >
                            <Ionicons name="add-circle-outline" size={20} color={theme.primary} />
                            <Text style={styles.addCategoryTextLandscapeStyle}>{t('aacBoard.addCategory')}</Text>
                          </TouchableOpacity>
                        </ScrollView>
                      )}
                    </View>
                  </View>
                  
                  <View style={styles.landscapeRight}>
                    {recentPhrases.length > 0 && (
                      <Animated.View 
                        style={[
                          styles.recentContainerLandscape,
                          {
                            opacity: recentPhrasesAnimation,
                            maxHeight: recentPhrasesAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, 100], // Appropriate height for landscape header + content
                            }),
                          },
                        ]}
                      >
                        <TouchableOpacity 
                          style={styles.sectionHeaderSmall}
                          onPress={toggleRecentPhrases}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.sectionTitleSmall}>{t('aacBoard.recentPhrases')}</Text>
                          <Ionicons 
                            name={isRecentPhrasesCollapsed ? 'chevron-down' : 'chevron-up'} 
                            size={16} 
                            color={theme.text} 
                          />
                        </TouchableOpacity>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={true}
                          contentContainerStyle={styles.recentScrollViewLandscape}
                          nestedScrollEnabled={true}
                        >
                          {recentPhrases.slice(0, 3).map((phrase) => (
                            <TouchableOpacity
                              key={phrase.id}
                              style={[
                                styles.recentButtonSmall,
                                phrase.id.startsWith('custom-') && styles.customRecentButton
                              ]}
                              onPress={() => speakPhrase(phrase.text, phrase.id)}
                              onLongPress={() => handlePhraseActions(phrase)}
                            >
                              {phrase.id.startsWith('custom-') && (
                                <Ionicons name="chatbox-outline" size={10} color={theme.primary} style={styles.customIcon} />
                              )}
                              <Text style={styles.recentTextSmall} numberOfLines={1}>
                                {phrase.text}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </Animated.View>
                    )}
                    
                    {/* Floating expand button when recent phrases are collapsed in landscape */}
                    {recentPhrases.length > 0 && isRecentPhrasesCollapsed && (
                      <TouchableOpacity 
                        style={styles.floatingExpandButtonLandscape}
                        onPress={toggleRecentPhrases}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="time-outline" size={14} color="#FFFFFF" />
                        <Ionicons name="chevron-down" size={12} color="#FFFFFF" />
                      </TouchableOpacity>
                    )}
                    
                    <View style={styles.phrasesContainerLandscape}>
                      <FlatList
                        data={selectedCategory === 'all' ? allPhrases : (phrases[selectedCategory] || [])}
                        renderItem={renderPhraseItem}
                        keyExtractor={(item) => item.id}
                        numColumns={3}
                        contentContainerStyle={styles.phrasesList}
                        ListEmptyComponent={renderEmptyPhrases}
                        showsVerticalScrollIndicator={true}
                        nestedScrollEnabled={true}
                      />
                    </View>
                  </View>
                </View>
              ) : (
                // Portrait layout: original vertical stack
                <View style={styles.portraitContainer}>
                  <TutorialTarget id="aac-categories-list">
                    <View style={styles.categoriesContainer}>
                      {isCategoriesLoading ? (
                        <View style={styles.loadingCategories}>
                          <ActivityIndicator size="small" color={theme.primary} />
                        </View>
                      ) : (
                        <FlatList
                          data={categories}
                          renderItem={renderCategoryItem}
                          keyExtractor={(item) => item.id}
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.categoriesList}
                          ListFooterComponent={
                            <TouchableOpacity
                              style={styles.addCategoryButton}
                              onPress={handleAddCategory}
                            >
                              <Ionicons name="add-circle-outline" size={24} color={theme.primary} />
                              <Text style={styles.addCategoryText}>{t('aacBoard.addCategory')}</Text>
                            </TouchableOpacity>
                          }
                        />
                      )}
                    </View>
                  </TutorialTarget>
                  
                  {recentPhrases.length > 0 && (
                    <Animated.View 
                      style={[
                        styles.recentContainer,
                        {
                          opacity: recentPhrasesAnimation,
                          maxHeight: recentPhrasesAnimation.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 120], // Enough height for header + content
                          }),
                          overflow: 'hidden',
                        },
                      ]}
                    >
                      <TouchableOpacity 
                        style={styles.sectionHeader}
                        onPress={toggleRecentPhrases}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.sectionTitle}>{t('aacBoard.recentPhrases')}</Text>
                        <Ionicons 
                          name={isRecentPhrasesCollapsed ? 'chevron-down' : 'chevron-up'} 
                          size={20} 
                          color={theme.text} 
                        />
                      </TouchableOpacity>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.recentScrollView}
                      >
                        {recentPhrases.map((phrase) => (
                          <TouchableOpacity
                            key={phrase.id}
                            style={[
                              styles.recentButton,
                              phrase.id.startsWith('custom-') && styles.customRecentButton
                            ]}
                            onPress={() => speakPhrase(phrase.text, phrase.id)}
                            onLongPress={() => handlePhraseActions(phrase)}
                          >
                            {phrase.id.startsWith('custom-') && (
                              <Ionicons name="chatbox-outline" size={12} color={theme.primary} style={styles.customIcon} />
                            )}
                            <Text style={styles.recentText} numberOfLines={1}>
                              {phrase.text}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </Animated.View>
                  )}
                  
                  {/* Floating expand button when recent phrases are collapsed */}
                  {recentPhrases.length > 0 && isRecentPhrasesCollapsed && (
                    <TouchableOpacity 
                      style={styles.floatingExpandButton}
                      onPress={toggleRecentPhrases}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="time-outline" size={16} color="#FFFFFF" />
                      <Ionicons name="chevron-down" size={14} color="#FFFFFF" />
                    </TouchableOpacity>
                  )}
                  
                  <View style={styles.phrasesContainer}>
                    <FlatList
                      data={selectedCategory === 'all' ? allPhrases : (phrases[selectedCategory] || [])}
                      renderItem={renderPhraseItem}
                      keyExtractor={(item) => item.id}
                      numColumns={2}
                      contentContainerStyle={styles.phrasesList}
                      ListEmptyComponent={renderEmptyPhrases}
                      showsVerticalScrollIndicator={true}
                      nestedScrollEnabled={true}
                    />
                  </View>
                </View>
              )}
            </View>
            
            {/* Custom Message Container - positioned at bottom */}
            <View style={styles.customMessageContainer}>
              <TouchableOpacity 
                style={styles.inputContainer}
                onPress={() => setTypingModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.input,
                  { color: customMessage ? theme.text : theme.text + '80' }
                ]}>
                  {customMessage || (isSpeaking ? t('general.loading') : t('home.typeMessage'))}
                </Text>
                {customMessage.length > 0 && !isSpeaking && (
                  <View style={styles.inputActions}>
                    <TouchableOpacity 
                      style={styles.inputActionButton} 
                      onPress={(e) => {
                        e.stopPropagation();
                        handleAddPhraseWithText(customMessage.trim());
                      }}
                    >
                      <Ionicons name="bookmark-outline" size={20} color={theme.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.inputActionButton} 
                      onPress={(e) => {
                        e.stopPropagation();
                        setCustomMessage('');
                      }}
                    >
                      <Ionicons name="close-circle" size={20} color={theme.text + '80'} />
                    </TouchableOpacity>
                  </View>
                )}
                {isSpeaking && (
                  <TouchableOpacity 
                    style={styles.inputActionButton} 
                    onPress={(e) => {
                      e.stopPropagation();
                      handleStopSpeaking();
                    }}
                  >
                    <Ionicons name="stop-circle" size={20} color={theme.primary} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.speakButton,
                  (!customMessage.trim() || isSpeaking) && styles.speakButtonDisabled,
                ]}
                onPress={speakCustomMessage}
                disabled={!customMessage.trim() || isSpeaking}
              >
                {isLoadingAudio && isSpeaking ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="volume-high" size={24} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
          
          {/* Sentence Form Modal */}
          <SentenceFormModal
            visible={sentenceFormVisible}
            onClose={() => setSentenceFormVisible(false)}
            onSave={handleSaveSentence}
            categories={categories.filter(cat => cat.id !== 'all')}
            editSentence={editingSentence}
            currentLanguage={currentLanguage}
          />
          
          {/* Category Form Modal */}
          <CategoryFormModal
            visible={categoryFormVisible}
            onClose={() => setCategoryFormVisible(false)}
            onSave={handleSaveCategory}
            editCategory={editingCategory}
            currentLanguage={currentLanguage}
          />

          {/* Sentence Reorder Mode Modal */}
          <SentenceReorderMode
            visible={reorderModeVisible}
            onClose={() => {
              setReorderModeVisible(false);
              setReorderCategoryId('');
            }}
            categoryId={reorderCategoryId}
            categoryName={categories.find(c => c.id === reorderCategoryId)?.name || ''}
            categoryColor={categories.find(c => c.id === reorderCategoryId)?.color || theme.primary}
            sentences={phrases[reorderCategoryId] || []}
            onSave={handleSaveReorder}
          />
        </View>
      </KeyboardAvoidingView>
      
      {/* Typing Modal */}
      <TypingModal
        visible={typingModalVisible}
        onClose={() => setTypingModalVisible(false)}
        customMessage={customMessage}
        onChangeText={setCustomMessage}
        isSpeaking={isSpeaking}
        isLoadingAudio={isLoadingAudio}
        onSpeak={speakCustomMessage}
        onSave={() => handleAddPhraseWithText(customMessage.trim())}
        onClear={() => setCustomMessage('')}
        onStop={handleStopSpeaking}
        theme={theme}
        t={t}
        userPlanId={profileData?.subscription?.tier}
        savedModelId={userSettings?.voiceSettings?.modelId}
        onModelChange={handleModelChange}
      />
      
      {/* Model Selection Modal */}
      <ModelSelectionModal
        visible={modelSelectorVisible}
        onClose={() => setModelSelectorVisible(false)}
        selectedModel={currentModelId}
        onModelChange={handleModelChange}
        onLearnMore={() => {
          setModelSelectorVisible(false);
          setModelInfoVisible(true);
        }}
        theme={theme}
      />
      
      {/* Model Info Modal */}
      <ModelInfoModal
        visible={modelInfoVisible}
        onClose={() => setModelInfoVisible(false)}
        theme={theme}
      />
      
      {/* Credit Limit Modal */}
      <CreditLimitModal
        visible={creditLimitModalVisible}
        onClose={() => setCreditLimitModalVisible(false)}
        onUpgrade={handleSubscriptionUpgrade}
      />
    </SafeAreaView>
  );
};

const makeStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  limitBanner: {
    backgroundColor: theme.error || '#EF4444',
    padding: 8,
    width: '100%',
  },
  limitBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  limitBannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginHorizontal: 8,
  },
  limitBannerButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  limitBannerButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    padding: 8,
  },
  modelSelectorButton: {
    position: 'relative',
  },
  modelIconContainer: {
    position: 'relative',
  },
  modelBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: 'bold',
  },
  categoriesContainer: {
    height: 90,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  loadingCategories: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoriesList: {
    paddingHorizontal: 15,
    alignItems: 'center',
    height: 90,
  },
  categoryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: theme.card,
    width: 100,
    height: 70,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: theme.border,
  },
  selectedCategoryButton: {
    backgroundColor: theme.primary,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.text,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 16,
  },
  selectedCategoryText: {
    color: '#FFFFFF',
  },
  recentContainer: {
    marginTop: 15,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 10,
  },
  recentScrollView: {
    paddingBottom: 10,
  },
  recentButton: {
    backgroundColor: theme.card,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    maxWidth: 200,
    borderWidth: 1,
    borderColor: theme.border,
  },
  customRecentButton: {
    borderColor: theme.primary,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
  },
  customIcon: {
    marginRight: 5,
  },
  recentText: {
    color: theme.text,
    fontSize: 14,
  },
  phrasesContainer: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: 15,
  },
  phrasesList: {
    paddingBottom: 0,
  },
  phraseButton: {
    flex: 1,
    backgroundColor: theme.card,
    margin: 4,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
    maxHeight: 80,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: theme.border,
  },
  phraseText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 16,
  },
  phraseIconContainer: {
    position: 'absolute',
    top: 6,
    left: 6,
  },
  phraseEmoji: {
    fontSize: 20,
  },
  customMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.card,
    ...Platform.select({
      ios: {
        paddingBottom: 30,
      },
    }),
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.background,
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 5,
    minHeight: 50,
    borderWidth: 1,
    borderColor: theme.border,
  },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    maxHeight: 80,
  },
  inputActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputActionButton: {
    padding: 5,
  },
  speakButton: {
    backgroundColor: theme.primary,
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  speakButtonDisabled: {
    backgroundColor: theme.primary + '80',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: 200,
  },
  emptyText: {
    fontSize: 16,
    color: theme.text,
    textAlign: 'center',
    marginTop: 10,
  },
  retryButton: {
    marginTop: 15,
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: theme.primary,
    borderRadius: 20,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primary,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginTop: 15,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 5,
  },
  addCategoryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: theme.card,
    width: 100,
    height: 70,
    borderWidth: 1,
    borderColor: theme.border,
    borderStyle: 'dashed',
  },
  addCategoryText: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.primary,
    marginTop: 4,
    textAlign: 'center',
  },
  playingPhraseButton: {
    borderColor: theme.primary,
    borderWidth: 2,
    backgroundColor: theme.card,
  },
  playingPhraseButtonLandscape: {
    borderColor: theme.primary,
    borderWidth: 2,
    backgroundColor: theme.card,
  },
  playingIndicatorContainer: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    backgroundColor: theme.primary,
    borderRadius: 10,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stopButton: {
    padding: 2,
  },
  helpButton: {
    padding: 8,
  },
  landscapeContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  landscapeLeft: {
    width: 120, // Fixed narrow width for categories
    borderRightWidth: 1,
    borderRightColor: theme.border,
    backgroundColor: theme.card,
  },
  categoriesContainerLandscape: {
    flex: 1,
    paddingVertical: 10,
  },
  categoriesListLandscape: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addCategoryButtonLandscape: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: 4,
    padding: 6,
    borderRadius: 8,
    backgroundColor: theme.card,
    width: 80,
    height: 50,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedCategoryButtonLandscape: {
    backgroundColor: theme.primary,
  },
  categoryTextLandscape: {
    fontSize: 10,
    fontWeight: '500',
    color: theme.text,
    marginTop: 2,
    textAlign: 'center',
    lineHeight: 12,
  },
  landscapeRight: {
    flex: 1,
    backgroundColor: theme.background,
  },
  recentContainerLandscape: {
    marginTop: 15,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  sectionTitleSmall: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 8,
  },
  recentScrollViewLandscape: {
    paddingBottom: 8,
  },
  recentButtonSmall: {
    backgroundColor: theme.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
    maxWidth: 150,
    borderWidth: 1,
    borderColor: theme.border,
  },
  recentTextSmall: {
    color: theme.text,
    fontSize: 12,
  },
  phrasesContainerLandscape: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: 15,
  },
  portraitContainer: {
    flex: 1,
  },
  categoryButtonLandscape: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: 4,
    padding: 6,
    borderRadius: 8,
    backgroundColor: theme.card,
    width: 80,
    height: 50,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  addCategoryTextLandscapeStyle: {
    fontSize: 10,
    fontWeight: '500',
    color: theme.primary,
    marginTop: 2,
    textAlign: 'center',
  },
  fallbackBanner: {
    backgroundColor: '#E0E7FF', // Light blue background
    padding: 12,
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  fallbackBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fallbackBannerText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginHorizontal: 8,
  },
  fallbackBannerButton: {
    padding: 4,
  },
  phraseButtonLandscape: {
    flex: 1,
    backgroundColor: theme.card,
    margin: 3,
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    maxHeight: 65,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: theme.border,
  },
  phraseTextLandscape: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
  },
  collapsibleContent: {
    overflow: 'hidden',
  },
  sectionHeaderSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
  },
  floatingExpandButton: {
    position: 'absolute',
    top: 93, // Position just below the categories
    right: 25, // Move to left margin instead of right
    padding: 6,
    borderRadius: 16,
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    zIndex: 1000,
  },
  floatingExpandButtonLandscape: {
    position: 'absolute',
    top: 5, // Position below the categories in landscape
    right: 40, // Position it just to the right of the categories bar
    padding: 5,
    borderRadius: 14,
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    zIndex: 1000,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
    flexDirection: 'column', // Ensure vertical layout
  },
  contentArea: {
    flex: 1,
  },
});

export default AACBoardScreen; 