/**
 * Speech Enhancer Screen
 * 
 * Continuous speech recording with automatic enhancement for users with speech impairments.
 * Features:
 * - Continuous recording with Voice Activity Detection (VAD)
 * - Automatic phrase detection and processing
 * - Low-confidence word correction
 * - Real-time speech enhancement using STT → Dictionary → TTS pipeline
 * 
 * @module screens/SpeechEnhancer/SpeechEnhancerScreen
 */

import React, { useState, useContext, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';

// Contexts
import { ThemeContext } from '../../contexts/ThemeContext';

// Services and Hooks
import { ContinuousRecordingService, VADDiagnostics } from '../../services/ContinuousRecordingService';
import { dictionaryService } from '../../services/dictionaryService';
import { useTextToSpeech } from '../../hooks/useTextToSpeech';
import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import { apiService } from '../../services/apiService';

// Components
import { ScreenHeader } from '../../components/UI/ScreenHeader';
import { CorrectionBanner, LowConfidenceWord } from '../../components/molecules/CorrectionBanner';

type RecordingMode = 'continuous' | 'press-to-talk';

interface ProcessedPhrase {
  id: string;
  text: string;
  timestamp: Date;
  lowConfidenceWords: LowConfidenceWord[];
  processed: boolean;
}

const SpeechEnhancerScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useContext(ThemeContext);
  const { speak, stopSpeaking } = useTextToSpeech();
  const { userSettings, refreshSettings } = useVoiceSettings();

  // Recording mode
  const [mode, setMode] = useState<RecordingMode>('press-to-talk');
  
  // Recording state
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false); // For press-to-talk
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [hasAudioPermission, setHasAudioPermission] = useState<boolean | null>(null);
  
  // Phrase history
  const [phrases, setPhrases] = useState<ProcessedPhrase[]>([]);
  const [currentLowConfidenceWords, setCurrentLowConfidenceWords] = useState<LowConfidenceWord[]>([]);
  const [currentSentence, setCurrentSentence] = useState<string>('');
  
  // Settings
  const [showCorrections, setShowCorrections] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false); // Only used in development
  
  // VAD Configuration (user-adjustable)
  const [vadSensitivity, setVadSensitivity] = useState(0.2); // 0.1-0.5 (lower = less noise tolerance)
  const [vadSilenceDuration, setVadSilenceDuration] = useState(0.7); // 0.5-2.0 seconds
  
  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [audioSkipCount, setAudioSkipCount] = useState(0); // Track skipped audio chunks
  
  // VAD Diagnostics (development only)
  const [vadDiagnostics, setVadDiagnostics] = useState<VADDiagnostics | null>(null);
  const isDevelopment = __DEV__;
  
  // Service references
  const recordingService = useRef<ContinuousRecordingService | null>(null);
  const pressToTalkRecording = useRef<Audio.Recording | null>(null);
  const unsubscribeDiagnostics = useRef<(() => void) | null>(null);
  const pressStartTime = useRef<number>(0);
  const isHoldMode = useRef<boolean>(false);

  // Initialize recording service with user settings
  const initializeRecordingService = () => {
    // Clean up existing service
    if (unsubscribeDiagnostics.current) {
      unsubscribeDiagnostics.current();
      unsubscribeDiagnostics.current = null;
    }
    if (recordingService.current?.isActive()) {
      recordingService.current.stop();
    }

    // Create new service with current settings
    recordingService.current = new ContinuousRecordingService({
      silenceDuration: vadSilenceDuration * 1000,  // Convert seconds to milliseconds
      minPhraseDuration: 300,                      // 300ms minimum (catch short words)
      energyThreshold: vadSensitivity,             // User-configurable noise tolerance
      meteringInterval: 80,                        // 80ms updates (responsive)
      adaptiveThreshold: true,                     // Enable adaptive threshold
      debugMode: true,                             // Enable detailed logging
    });

    // Subscribe to diagnostics (development only)
    if (recordingService.current && __DEV__) {
      unsubscribeDiagnostics.current = recordingService.current.subscribeToDiagnostics((diag) => {
        setVadDiagnostics(diag);
      });
    }
  };

  // Initialize recording service on mount
  useEffect(() => {
    initializeRecordingService();

    return () => {
      // Cleanup on unmount
      if (unsubscribeDiagnostics.current) {
        unsubscribeDiagnostics.current();
      }
      if (recordingService.current?.isActive()) {
        recordingService.current.stop();
      }
      if (pressToTalkRecording.current) {
        pressToTalkRecording.current.stopAndUnloadAsync();
      }
    };
  }, []);

  // Reinitialize service when VAD settings change
  useEffect(() => {
    // Only reinitialize if service exists and is not currently active
    if (recordingService.current && !isListening) {
      console.log('[SpeechEnhancer] VAD settings changed, reinitializing service');
      initializeRecordingService();
    }
  }, [vadSensitivity, vadSilenceDuration]);

  // Check audio permissions on mount
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const { status } = await Audio.getPermissionsAsync();
        setHasAudioPermission(status === 'granted');
      } catch (error) {
        console.error('[SpeechEnhancer] Error checking permissions:', error);
        setHasAudioPermission(false);
      }
    };
    checkPermissions();
  }, []);

  // Stop any active recording when mode changes
  useEffect(() => {
    if (mode === 'continuous' && pressToTalkRecording.current) {
      stopPressToTalkRecording();
    } else if (mode === 'press-to-talk' && isListening) {
      stopListening();
    }
  }, [mode]);

  /**
   * Start continuous listening mode
   */
  const startListening = async () => {
    if (!recordingService.current) {
      Alert.alert(
        t('general.error.title'),
        t('speechEnhancer.recordingServiceNotInitialized', 'Recording service not initialized')
      );
      return;
    }

    try {
      setIsListening(true);
      setAudioSkipCount(0); // Reset skip counter
      console.log('[SpeechEnhancer] Starting continuous mode');

      await recordingService.current.startContinuousMode(handlePhraseDetected);
    } catch (error: any) {
      console.error('[SpeechEnhancer] Failed to start listening:', error);
      Alert.alert(
        t('general.error.title'),
        error.message || t('speechEnhancer.failedToStartRecording', 'Failed to start recording')
      );
      setIsListening(false);
    }
  };

  /**
   * Stop continuous listening mode
   */
  const stopListening = async () => {
    if (!recordingService.current) return;

    try {
      console.log('[SpeechEnhancer] Stopping continuous mode');
      await recordingService.current.stop();
      setIsListening(false);
    } catch (error) {
      console.error('[SpeechEnhancer] Failed to stop listening:', error);
    }
  };

  /**
   * Handle detected phrase from VAD
   */
  const handlePhraseDetected = async (audioUri: string): Promise<void> => {
    console.log('[SpeechEnhancer] Phrase detected, processing...');
    setIsProcessing(true);

    try {
      // Validate audio file exists and has content
      const audioInfo = await FileSystem.getInfoAsync(audioUri);
      if (!audioInfo.exists) {
        console.warn('[SpeechEnhancer] Audio file does not exist:', audioUri);
        return;
      }

      // Check file size - skip very small files (likely empty or corrupt)
      const MIN_AUDIO_SIZE = 1000; // 1KB minimum
      if (audioInfo.size && audioInfo.size < MIN_AUDIO_SIZE) {
        console.log(`[SpeechEnhancer] Audio too small (${audioInfo.size} bytes), skipping`);
        setAudioSkipCount(prev => prev + 1);
        return;
      }

      console.log('[SpeechEnhancer] Audio file valid:', {
        size: audioInfo.size,
        uri: audioUri
      });

      // Read audio file
      const audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Additional validation: check base64 length
      if (!audioBase64 || audioBase64.length < 100) {
        console.log('[SpeechEnhancer] Audio data too small or empty, skipping');
        setAudioSkipCount(prev => prev + 1);
        return;
      }

      // Get user's language and settings
      const language = i18n.language || 'en';
      const enhancementEnabled = userSettings?.voiceSettings?.enhancementEnabled || false;
      // Default threshold of 0.7 catches words with < 70% confidence
      // (ElevenLabs uses 0.8 base confidence for speech impaired users)
      const confidenceThreshold = userSettings?.voiceSettings?.confidenceThreshold || 0.7;

      console.log('[SpeechEnhancer] Using language for STT:', language);
      console.log('[SpeechEnhancer] Enhancement enabled:', enhancementEnabled);
      console.log('[SpeechEnhancer] Confidence threshold:', confidenceThreshold);

      // Send to STT API with enhancement settings
      const sttResult = await apiService.post<any>('/api/stt', {
        audio: audioBase64,
        language,
        enhancementEnabled,
        confidenceThreshold,
      });

      // Check if audio was skipped by backend
      if (sttResult.skipped) {
        console.log('[SpeechEnhancer] Audio skipped by backend:', sttResult.reason);
        setAudioSkipCount(prev => prev + 1);
        return;
      }

      const transcribedText = sttResult.text || '';
      const lowConfidenceWords = sttResult.lowConfidenceWords || [];

      console.log('[SpeechEnhancer] Transcribed:', transcribedText);
      console.log('[SpeechEnhancer] Low confidence words:', lowConfidenceWords.length);
      
      if (lowConfidenceWords.length > 0) {
        console.log('[SpeechEnhancer] Low confidence details:', lowConfidenceWords.map((w: any) => ({
          word: w.word,
          confidence: (w.confidence * 100).toFixed(1) + '%'
        })));
      }

      if (!transcribedText.trim()) {
        console.log('[SpeechEnhancer] Empty transcription, skipping');
        setAudioSkipCount(prev => prev + 1);
        return;
      }

      // Dictionary enhancements are already applied in the STT response
      // The backend automatically applies dictionary replacements
      let enhancedText = transcribedText;

      console.log('[SpeechEnhancer] Enhanced:', enhancedText);

      // Create phrase record
      const newPhrase: ProcessedPhrase = {
        id: Date.now().toString(),
        text: enhancedText,
        timestamp: new Date(),
        lowConfidenceWords: enhancementEnabled ? lowConfidenceWords : [],
        processed: true,
      };

      // Add to history
      setPhrases(prev => [newPhrase, ...prev].slice(0, 50)); // Keep last 50 phrases
      
      // Reset skip counter on successful processing
      if (audioSkipCount > 0) {
        setAudioSkipCount(0);
      }

      // Show sentence for corrections ONLY if enhancement is enabled
      // Display sentence even if no low-confidence words (user can still add words to dictionary)
      if (enhancementEnabled && enhancedText.trim()) {
        setCurrentLowConfidenceWords(lowConfidenceWords);
        setCurrentSentence(enhancedText);
      } else {
        // Clear the banner if enhancement is disabled
        setCurrentLowConfidenceWords([]);
        setCurrentSentence('');
      }

      // Auto-speak if enabled (use backend setting)
      const autoSpeakEnabled = userSettings?.voiceSettings?.autoSpeakEnabled ?? true;
      if (autoSpeakEnabled && enhancedText.trim()) {
        await speakText(enhancedText);
      }
    } catch (error: any) {
      console.error('[SpeechEnhancer] Error processing phrase:', error);
      
      // Only show error alert for significant errors (not empty audio or skipped)
      if (error?.message && !error.message.includes('too small') && !error.message.includes('skipped')) {
        // Don't interrupt user experience with alerts for transient errors, just log
        console.warn('[SpeechEnhancer] Processing failed but continuing:', error.message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Speak text using TTS
   */
  const speakText = async (text: string) => {
    try {
      setIsSpeaking(true);
      
      // Notify recording service that TTS is playing (echo cancellation)
      recordingService.current?.setTTSPlaying(true);

      // Use current app language for TTS
      const language = i18n.language || 'en';
      console.log('[SpeechEnhancer] Speaking with language:', language);
      
      await speak(text, undefined, undefined, language);
    } catch (error) {
      console.error('[SpeechEnhancer] TTS error:', error);
    } finally {
      setIsSpeaking(false);
      recordingService.current?.setTTSPlaying(false);
    }
  };

  /**
   * Handle word correction
   */
  const handleCorrectWord = async (word: string, correction: string) => {
    try {
      const language = i18n.language || 'en';
      
      console.log(`[SpeechEnhancer] Creating auto-learned correction: "${word}" → "${correction}" for language: ${language}`);
      
      await dictionaryService.createAutoLearnedCorrection(
        word,
        correction,
        language,
        0.7 // Initial confidence
      );

      Alert.alert(
        t('general.success.title'),
        t('speechEnhancer.learnedCorrection', 'Learned: "{{word}}" → "{{correction}}"', { word, correction })
      );

      // Remove corrected word from current list
      setCurrentLowConfidenceWords(prev =>
        prev.filter(w => w.word !== word)
      );
    } catch (error: any) {
      console.error('[SpeechEnhancer] Error saving correction:', error);
      Alert.alert(
        t('general.error.title'),
        t('speechEnhancer.failedToSaveCorrection', 'Failed to save correction')
      );
    }
  };

  /**
   * Request audio permissions
   */
  const requestAudioPermission = async (): Promise<boolean> => {
    if (isRequestingPermission) {
      console.log('[SpeechEnhancer] Permission request already in progress');
      return false;
    }

    try {
      setIsRequestingPermission(true);
      console.log('[SpeechEnhancer] Requesting audio permissions...');
      
      const { status } = await Audio.requestPermissionsAsync();
      const granted = status === 'granted';
      
      setHasAudioPermission(granted);
      console.log('[SpeechEnhancer] Permission result:', granted ? 'granted' : 'denied');
      
      if (!granted) {
        Alert.alert(
          t('general.error.title'),
          t('speechEnhancer.microphonePermissionNotGranted', 'Microphone permission is required to record audio')
        );
      }
      
      return granted;
    } catch (error) {
      console.error('[SpeechEnhancer] Error requesting permissions:', error);
      setHasAudioPermission(false);
      return false;
    } finally {
      setIsRequestingPermission(false);
    }
  };

  /**
   * Cleanup any existing recording
   */
  const cleanupPressToTalkRecording = async () => {
    if (pressToTalkRecording.current) {
      try {
        console.log('[SpeechEnhancer] Cleaning up existing recording');
        await pressToTalkRecording.current.stopAndUnloadAsync();
      } catch (error: any) {
        // Ignore errors if recording doesn't exist anymore
        if (!error.message?.toLowerCase().includes('does not exist')) {
          console.warn('[SpeechEnhancer] Error cleaning up recording:', error);
        }
      } finally {
        pressToTalkRecording.current = null;
      }
    }
  };

  /**
   * Start press-to-talk recording (internal)
   */
  const startPressToTalkRecordingInternal = async (): Promise<boolean> => {
    // Prevent multiple concurrent recordings
    if (isRecording || pressToTalkRecording.current) {
      console.log('[SpeechEnhancer] Recording already in progress, ignoring');
      return false;
    }

    // Don't start if processing or speaking
    if (isProcessing || isSpeaking) {
      console.log('[SpeechEnhancer] System busy, cannot start recording');
      return false;
    }

    try {
      console.log('[SpeechEnhancer] Starting press-to-talk recording');
      
      // Check permission first
      if (hasAudioPermission !== true) {
        const granted = await requestAudioPermission();
        if (!granted) {
          return false;
        }
      }

      // Clean up any stale recording
      await cleanupPressToTalkRecording();

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });

      // Create new recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      pressToTalkRecording.current = recording;
      setIsRecording(true);
      console.log('[SpeechEnhancer] Recording started successfully');
      return true;
    } catch (error: any) {
      console.error('[SpeechEnhancer] Failed to start press-to-talk recording:', error);
      
      // Clean up on error
      await cleanupPressToTalkRecording();
      setIsRecording(false);
      
      // Only show alert if it's not a permission issue (already handled)
      if (!error.message?.includes('permission')) {
        Alert.alert(
          t('general.error.title'),
          error.message || t('speechEnhancer.failedToStartRecording', 'Failed to start recording')
        );
      }
      return false;
    }
  };

  /**
   * Handle press in (for hold mode)
   */
  const handlePressIn = async () => {
    console.log('[SpeechEnhancer] Press In detected');
    pressStartTime.current = Date.now();
    isHoldMode.current = false;
    
    // Start recording immediately
    await startPressToTalkRecordingInternal();
  };

  /**
   * Handle press out (for hold mode)
   */
  const handlePressOut = async () => {
    const pressDuration = Date.now() - pressStartTime.current;
    console.log('[SpeechEnhancer] Press Out detected, duration:', pressDuration);
    
    // If held for more than 200ms, it's hold mode
    if (pressDuration >= 200) {
      console.log('[SpeechEnhancer] Hold mode detected');
      isHoldMode.current = true;
      await stopPressToTalkRecording();
    }
    // Otherwise it's a tap, handled by onPress
  };

  /**
   * Stop press-to-talk recording and process
   */
  const stopPressToTalkRecording = async () => {
    if (!pressToTalkRecording.current) {
      console.log('[SpeechEnhancer] No recording object to stop');
      setIsRecording(false);
      return;
    }

    if (!isRecording) {
      console.log('[SpeechEnhancer] Recording state already false');
      await cleanupPressToTalkRecording();
      return;
    }

    // Store reference before any async operations
    const recordingRef = pressToTalkRecording.current;

    try {
      console.log('[SpeechEnhancer] Stopping press-to-talk recording');
      
      // Get status BEFORE stopping
      let status;
      try {
        status = await recordingRef.getStatusAsync();
      } catch (statusError) {
        console.warn('[SpeechEnhancer] Could not get recording status:', statusError);
        // Recording might already be stopped, try to get URI anyway
      }
      
      // Check if recording duration is too short (< 150ms to avoid accidental taps)
      if (status?.durationMillis && status.durationMillis < 150) {
        console.log(`[SpeechEnhancer] Recording too short (${status.durationMillis}ms), skipping`);
        await cleanupPressToTalkRecording();
        setIsRecording(false);
        return;
      }

      // Get URI before stopping (safer)
      let uri: string | null = null;
      try {
        uri = recordingRef.getURI();
      } catch (uriError) {
        console.warn('[SpeechEnhancer] Could not get URI before stopping:', uriError);
      }

      // Stop recording
      try {
        await recordingRef.stopAndUnloadAsync();
      } catch (stopError: any) {
        console.warn('[SpeechEnhancer] Error stopping recording (may already be stopped):', stopError);
        // Try to get URI again if we didn't get it before
        if (!uri) {
          try {
            uri = recordingRef.getURI();
          } catch (e) {
            console.warn('[SpeechEnhancer] Could not get URI after stop error');
          }
        }
      }
      
      // Clean up reference immediately
      pressToTalkRecording.current = null;
      setIsRecording(false);

      // Process the audio if we have a URI
      if (uri) {
        console.log('[SpeechEnhancer] Processing recorded audio:', uri);
        await handlePhraseDetected(uri);
      } else {
        console.warn('[SpeechEnhancer] No recording URI available, skipping processing');
      }
    } catch (error: any) {
      console.error('[SpeechEnhancer] Error in stopPressToTalkRecording:', error);
      
      // Ensure cleanup
      await cleanupPressToTalkRecording();
      setIsRecording(false);
      
      // Only show error if it's not just "recorder doesn't exist"
      if (!error.message?.toLowerCase().includes('does not exist') && 
          !error.message?.toLowerCase().includes('recorder')) {
        Alert.alert(
          t('general.error.title'),
          t('speechEnhancer.recordingError', 'Failed to process recording. Please try again.')
        );
      }
    }
  };

  /**
   * Handle tap (toggle mode)
   */
  const handleTap = async () => {
    // Wait a bit to see if it was a hold
    await new Promise(resolve => setTimeout(resolve, 250));
    
    // If it was a hold, don't process tap
    if (isHoldMode.current) {
      console.log('[SpeechEnhancer] Hold mode already handled, skipping tap');
      isHoldMode.current = false;
      return;
    }
    
    console.log('[SpeechEnhancer] Tap mode detected');
    
    // Toggle recording
    if (isRecording) {
      await stopPressToTalkRecording();
    } else {
      await startPressToTalkRecordingInternal();
    }
  };

  /**
   * Toggle listening (continuous mode)
   */
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  /**
   * Toggle mode between continuous and press-to-talk
   */
  const toggleMode = () => {
    setMode(prev => prev === 'continuous' ? 'press-to-talk' : 'continuous');
  };

  /**
   * Clear phrase history
   */
  const clearHistory = () => {
    Alert.alert(
      t('speechEnhancer.clearHistoryTitle', 'Clear History'),
      t('speechEnhancer.clearHistoryMessage', 'Are you sure you want to clear all phrases?'),
      [
        { text: t('general.cancel'), style: 'cancel' },
        {
          text: t('speechEnhancer.clear'),
          style: 'destructive',
          onPress: () => setPhrases([]),
        },
      ]
    );
  };

  // Get enhancement status
  const enhancementEnabled = userSettings?.voiceSettings?.enhancementEnabled || false;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader title={t('speechEnhancer.title', 'Speech Enhancer')} />

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Mode Selector */}
        <View style={[styles.modeSelector, { backgroundColor: theme.card }]}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'continuous' && { backgroundColor: theme.primary }
            ]}
            onPress={() => setMode('continuous')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="radio-outline"
              size={20}
              color={mode === 'continuous' ? '#FFFFFF' : theme.text}
            />
            <Text
              style={[
                styles.modeButtonText,
                { color: mode === 'continuous' ? '#FFFFFF' : theme.text }
              ]}
            >
              {t('speechEnhancer.continuous', 'Continuous')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'press-to-talk' && { backgroundColor: theme.primary }
            ]}
            onPress={() => setMode('press-to-talk')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="hand-left-outline"
              size={20}
              color={mode === 'press-to-talk' ? '#FFFFFF' : theme.text}
            />
            <Text
              style={[
                styles.modeButtonText,
                { color: mode === 'press-to-talk' ? '#FFFFFF' : theme.text }
              ]}
            >
              {t('speechEnhancer.pressToTalk', 'Press to Talk')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Continuous Mode Warning */}
        {mode === 'continuous' && (
          <View style={[styles.warningCard, { backgroundColor: '#FFF3E0', borderColor: '#FF9800' }]}>
            <Ionicons name="headset-outline" size={24} color="#FF9800" />
            <View style={styles.warningTextContainer}>
              <Text style={[styles.warningTitle, { color: '#F57C00' }]}>
                {t('speechEnhancer.continuousModeWarningTitle', 'Best with Headphones or External Mic')}
              </Text>
              <Text style={[styles.warningText, { color: '#E65100' }]}>
                {t('speechEnhancer.continuousModeWarning', 'Continuous mode works best with headphones or an external microphone to prevent the output speech from being recorded again by the microphone (echo feedback).')}
              </Text>
            </View>
          </View>
        )}

        {/* Status Card */}
        <View style={[styles.statusCard, { backgroundColor: theme.card }]}>
          <View style={styles.statusHeader}>
            <View style={[
              styles.statusIndicator,
              { backgroundColor: (isListening || isRecording) ? '#4CAF50' : '#9E9E9E' }
            ]} />
            <Text style={[styles.statusText, { color: theme.text }]}>
              {isListening 
                ? t('speechEnhancer.listening', 'Listening...') 
                : isRecording 
                ? t('speechEnhancer.recording', 'Recording...')
                : t('speechEnhancer.idle', 'Ready')}
            </Text>
          </View>

          {/* Main control button */}
          {mode === 'continuous' ? (
            <>
              <TouchableOpacity
                style={[
                  styles.mainButton,
                  {
                    backgroundColor: isListening ? '#F44336' : theme.primary,
                  }
                ]}
                onPress={toggleListening}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={isListening ? 'stop' : 'mic'}
                  size={48}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              <Text style={[styles.mainButtonLabel, { color: theme.text }]}>
                {isListening
                  ? t('speechEnhancer.stopListening', 'Stop Listening')
                  : t('speechEnhancer.startListening', 'Start Listening')}
              </Text>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.mainButton,
                  styles.pressToTalkButton,
                  {
                    backgroundColor: isRecording ? '#F44336' : isRequestingPermission ? '#9E9E9E' : theme.primary,
                    opacity: isRequestingPermission ? 0.6 : 1,
                  }
                ]}
                onPress={handleTap}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={isRequestingPermission}
                activeOpacity={0.8}
              >
                {isRequestingPermission ? (
                  <ActivityIndicator size="large" color="#FFFFFF" />
                ) : (
                  <Ionicons
                    name={isRecording ? 'stop' : 'mic'}
                    size={48}
                    color="#FFFFFF"
                  />
                )}
              </TouchableOpacity>

              <Text style={[styles.mainButtonLabel, { color: theme.text }]}>
                {isRequestingPermission
                  ? t('general.loading', 'Loading...')
                  : isRecording
                  ? t('speechEnhancer.recording', 'Recording...')
                  : t('speechEnhancer.holdToTalk', 'Hold to Talk')}
              </Text>
            </>
          )}

          {/* Processing indicator */}
          {isProcessing && (
            <View style={styles.processingIndicator}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.processingText, { color: theme.text }]}>
                {t('speechEnhancer.processing', 'Processing...')}
              </Text>
            </View>
          )}

          {/* Speaking indicator */}
          {isSpeaking && (
            <View style={styles.speakingIndicator}>
              <Ionicons name="volume-high" size={20} color={theme.primary} />
              <Text style={[styles.speakingText, { color: theme.text }]}>
                {t('speechEnhancer.speaking', 'Speaking...')}
              </Text>
            </View>
          )}

          {/* Silence Timer Indicator (Development Only) */}
          {isDevelopment && vadDiagnostics && vadDiagnostics.isSpeaking === false && 
           vadDiagnostics.isListening && mode === 'continuous' && 
           phrases.length === 0 && (
            <View style={styles.waitingIndicator}>
              <Ionicons name="mic" size={16} color={theme.primary} />
              <Text style={[styles.waitingText, { color: theme.text }]}>
                {t('speechEnhancer.waitingForSpeech', 'Listening... Speak, then pause 0.5s to send')}
              </Text>
            </View>
          )}

          {/* Audio quality warning */}
          {(isListening || isRecording) && audioSkipCount >= 3 && (
            <View style={styles.qualityWarning}>
              <Ionicons name="mic-off-outline" size={16} color="#FF9800" />
              <Text style={styles.qualityWarningText}>
                {t('speechEnhancer.audioQualityLow', 'Microphone may be too quiet or silent')}
              </Text>
            </View>
          )}
        </View>

        {/* Enhancement Toggle */}
        <View style={[styles.enhancementCard, { backgroundColor: theme.card }]}>
          <View style={styles.enhancementHeader}>
            <View style={styles.enhancementInfo}>
              <Text style={[styles.enhancementTitle, { color: theme.text }]}>
                {t('speechEnhancer.enableEnhancement', 'Speech Enhancement')}
              </Text>
              <Text style={[styles.enhancementDesc, { color: theme.text + '80' }]}>
                {t('speechEnhancer.enhancementDesc', 'Detect and correct unclear words')}
              </Text>
            </View>
            <Switch
              value={enhancementEnabled}
              onValueChange={async (value) => {
                if (!userSettings?.voiceSettings) return;
                try {
                  // Only send the fields the backend expects
                  // Normalize provider to match Prisma enum (ELEVEN_LABS not ELEVENLABS)
                  let provider = userSettings.voiceSettings.provider || 'ELEVEN_LABS';
                  if (provider === 'ELEVENLABS') provider = 'ELEVEN_LABS';
                  
                  const payload: any = {
                    enhancementEnabled: value,
                    provider: provider,
                    speed: userSettings.voiceSettings.settings?.speed || 1.0,
                    pitch: userSettings.voiceSettings.settings?.pitch || 0,
                    sttProvider: userSettings.voiceSettings.sttProvider || 'AUTO',
                    autoSpeakEnabled: userSettings.voiceSettings.autoSpeakEnabled !== undefined 
                      ? userSettings.voiceSettings.autoSpeakEnabled 
                      : true,
                    confidenceThreshold: userSettings.voiceSettings.confidenceThreshold || 0.7
                  };
                  
                  // Only include selectedVoice if it exists
                  if (userSettings.voiceSettings.selectedVoice?.id) {
                    payload.selectedVoice = userSettings.voiceSettings.selectedVoice.id;
                  }
                  
                  await apiService.post('/api/voice-settings', payload);
                  
                  // Refresh settings to update UI
                  await refreshSettings();
                  
                  // Clear the correction banner if enhancement is being disabled
                  if (!value) {
                    setCurrentLowConfidenceWords([]);
                    setCurrentSentence('');
                  }
                  
                  // Show toast notification
                  setToastMessage(value 
                    ? t('speechEnhancer.enhancementEnabled', 'Speech enhancement enabled')
                    : t('speechEnhancer.enhancementDisabled', 'Speech enhancement disabled'));
                  setTimeout(() => setToastMessage(null), 2000);
                } catch (err) {
                  console.error('Failed to update enhancement setting:', err);
                  setToastMessage(t('speechEnhancer.failedToUpdateEnhancement', 'Failed to update enhancement setting'));
                  setTimeout(() => setToastMessage(null), 3000);
                }
              }}
              trackColor={{ false: theme.border, true: theme.primary + '80' }}
              thumbColor={enhancementEnabled ? theme.primary : '#f4f3f4'}
            />
          </View>
        </View>

        {/* Sentence Correction Banner - Show when enhancement enabled and sentence exists */}
        {currentSentence && (
          <CorrectionBanner
            words={currentLowConfidenceWords}
            sentence={currentSentence}
            onCorrect={handleCorrectWord}
            onDismiss={() => {
              setCurrentLowConfidenceWords([]);
              setCurrentSentence('');
            }}
          />
        )}

        {/* Settings - Development Only (for VAD diagnostics) */}
        {isDevelopment && (
          <View style={[styles.settingsCard, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('speechEnhancer.settings', 'Settings')}
            </Text>

            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Ionicons name="create-outline" size={20} color={theme.text} />
                <Text style={[styles.settingLabel, { color: theme.text }]}>
                  {t('speechEnhancer.showCorrections', 'Show word corrections')}
                </Text>
              </View>
              <Switch
                value={showCorrections}
                onValueChange={setShowCorrections}
                trackColor={{ false: theme.border, true: theme.primary + '80' }}
                thumbColor={showCorrections ? theme.primary : '#f4f3f4'}
              />
            </View>

            {/* VAD Diagnostics Toggle */}
            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Ionicons name="bug-outline" size={20} color={theme.text} />
                <Text style={[styles.settingLabel, { color: theme.text }]}>
                  {t('speechEnhancer.showDiagnostics', 'Show VAD diagnostics')}
                </Text>
              </View>
              <Switch
                value={showDiagnostics}
                onValueChange={setShowDiagnostics}
                trackColor={{ false: theme.border, true: theme.primary + '80' }}
                thumbColor={showDiagnostics ? theme.primary : '#f4f3f4'}
              />
            </View>
          </View>
        )}

        {/* VAD Diagnostics Panel (Development Only) */}
        {isDevelopment && showDiagnostics && vadDiagnostics && mode === 'continuous' && (
          <View style={[styles.diagnosticsCard, { backgroundColor: theme.card, borderColor: theme.primary }]}>
            <View style={styles.diagnosticsHeader}>
              <Ionicons name="analytics-outline" size={20} color={theme.primary} />
              <Text style={[styles.diagnosticsTitle, { color: theme.text }]}>
                {t('speechEnhancer.vadDiagnostics', 'Voice Activity Detection')}
              </Text>
            </View>

            <View style={styles.diagnosticsGrid}>
              {/* Status */}
              <View style={styles.diagnosticItem}>
                <Text style={[styles.diagnosticLabel, { color: theme.text + '80' }]}>
                  {t('speechEnhancer.status', 'Status')}
                </Text>
                <Text style={[styles.diagnosticValue, { 
                  color: vadDiagnostics.isSpeaking ? '#4CAF50' : theme.text 
                }]}>
                  {vadDiagnostics.isSpeaking ? '🎤 Speaking' : '🔇 Silence'}
                </Text>
              </View>

              {/* Energy Level */}
              <View style={styles.diagnosticItem}>
                <Text style={[styles.diagnosticLabel, { color: theme.text + '80' }]}>
                  {t('speechEnhancer.energyLevel', 'Energy')}
                </Text>
                <Text style={[styles.diagnosticValue, { color: theme.text }]}>
                  {(vadDiagnostics.currentEnergy * 100).toFixed(1)}%
                </Text>
              </View>

              {/* Threshold */}
              <View style={styles.diagnosticItem}>
                <Text style={[styles.diagnosticLabel, { color: theme.text + '80' }]}>
                  {t('speechEnhancer.threshold', 'Threshold')}
                </Text>
                <Text style={[styles.diagnosticValue, { color: theme.text }]}>
                  {(vadDiagnostics.threshold * 100).toFixed(1)}%
                </Text>
              </View>

              {/* Phrase Duration */}
              <View style={styles.diagnosticItem}>
                <Text style={[styles.diagnosticLabel, { color: theme.text + '80' }]}>
                  {t('speechEnhancer.phraseDuration', 'Duration')}
                </Text>
                <Text style={[styles.diagnosticValue, { color: theme.text }]}>
                  {vadDiagnostics.phraseDuration > 0 
                    ? `${(vadDiagnostics.phraseDuration / 1000).toFixed(1)}s`
                    : '0s'}
                </Text>
              </View>

              {/* Chunk Count */}
              <View style={styles.diagnosticItem}>
                <Text style={[styles.diagnosticLabel, { color: theme.text + '80' }]}>
                  {t('speechEnhancer.chunks', 'Chunks')}
                </Text>
                <Text style={[styles.diagnosticValue, { color: theme.text }]}>
                  {vadDiagnostics.chunkCount}
                </Text>
              </View>

              {/* Metering Callbacks */}
              <View style={styles.diagnosticItem}>
                <Text style={[styles.diagnosticLabel, { color: theme.text + '80' }]}>
                  {t('speechEnhancer.callbacks', 'Callbacks')}
                </Text>
                <Text style={[styles.diagnosticValue, { color: theme.text }]}>
                  {vadDiagnostics.meteringCallbackCount}
                </Text>
              </View>
            </View>

            {/* Energy Bar Visualization */}
            <View style={styles.energyBarContainer}>
              <View style={[styles.energyBarBg, { backgroundColor: theme.border }]}>
                <View 
                  style={[
                    styles.energyBar, 
                    { 
                      width: `${Math.min(100, vadDiagnostics.currentEnergy * 100)}%`,
                      backgroundColor: vadDiagnostics.isSpeaking ? '#4CAF50' : '#9E9E9E'
                    }
                  ]} 
                />
                <View 
                  style={[
                    styles.thresholdMarker, 
                    { 
                      left: `${Math.min(100, vadDiagnostics.threshold * 100)}%`,
                      backgroundColor: theme.primary
                    }
                  ]} 
                />
              </View>
              <Text style={[styles.energyBarLabel, { color: theme.text + '60' }]}>
                {t('speechEnhancer.energyVisualization', 'Current energy (bar) vs threshold (line)')}
              </Text>
            </View>

            {/* Metering Value */}
            <View style={styles.meteringInfo}>
              <Text style={[styles.meteringLabel, { color: theme.text + '60' }]}>
                {t('speechEnhancer.meteringValue', 'Raw metering')}:
              </Text>
              <Text style={[styles.meteringValue, { color: theme.text + '80' }]}>
                {vadDiagnostics.lastMeteringValue.toFixed(1)} dB
              </Text>
            </View>

            {/* Warning if no callbacks */}
            {isListening && vadDiagnostics.meteringCallbackCount === 0 && (
              <View style={styles.diagnosticsWarning}>
                <Ionicons name="warning-outline" size={16} color="#FF9800" />
                <Text style={[styles.diagnosticsWarningText, { color: '#FF9800' }]}>
                  {t('speechEnhancer.noMeteringCallbacks', 'No audio callbacks received - check microphone permissions')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Phrase History */}
        <View style={[styles.historyCard, { backgroundColor: theme.card }]}>
          <View style={styles.historyHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('speechEnhancer.history', 'Recent Phrases')}
            </Text>
            {phrases.length > 0 && (
              <TouchableOpacity onPress={clearHistory}>
                <Text style={[styles.clearButton, { color: theme.primary }]}>
                  {t('speechEnhancer.clear', 'Clear')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {phrases.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="mic-off-outline" size={48} color={theme.border} />
              <Text style={[styles.emptyStateText, { color: theme.text }]}>
                {t('speechEnhancer.noPhrasesYet', 'No phrases processed yet')}
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.text + '80' }]}>
                {t('speechEnhancer.startListeningPrompt', 'Press the microphone button to start')}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.phrasesList} nestedScrollEnabled>
              {phrases.map((phrase) => (
                <View
                  key={phrase.id}
                  style={[styles.phraseItem, { borderBottomColor: theme.border }]}
                >
                  <View style={styles.phraseHeader}>
                    <Text style={[styles.phraseTime, { color: theme.text + '80' }]}>
                      {phrase.timestamp.toLocaleTimeString()}
                    </Text>
                    {phrase.lowConfidenceWords.length > 0 && (
                      <View style={styles.confidenceBadge}>
                        <Ionicons name="warning" size={12} color="#FF9800" />
                        <Text style={styles.confidenceBadgeText}>
                          {phrase.lowConfidenceWords.length}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.phraseText, { color: theme.text }]}>
                    {phrase.text}
                  </Text>
                  <TouchableOpacity
                    style={styles.replayButton}
                    onPress={() => speakText(phrase.text)}
                  >
                    <Ionicons name="play-circle-outline" size={20} color={theme.primary} />
                    <Text style={[styles.replayButtonText, { color: theme.primary }]}>
                      {t('speechEnhancer.replay', 'Replay')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* VAD Settings - Continuous Mode Only */}
        {mode === 'continuous' && (
          <View style={[styles.vadSettingsCard, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('speechEnhancer.voiceDetectionSettings', 'Voice Detection Settings')}
            </Text>
            <Text style={[styles.vadSettingsDesc, { color: theme.text + '80' }]}>
              {t('speechEnhancer.voiceDetectionDesc', 'Adjust how the app detects when you start and stop speaking')}
            </Text>
            
            {/* Environment Noise Setting */}
            <View style={styles.vadSettingItem}>
              <View style={styles.vadSettingHeader}>
                <Ionicons name="volume-medium-outline" size={20} color={theme.text} />
                <Text style={[styles.vadSettingLabel, { color: theme.text }]}>
                  {t('speechEnhancer.environmentNoise', 'Your Environment')}
                </Text>
              </View>
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelContainer}>
                  <Ionicons name="volume-mute-outline" size={16} color={theme.text + '80'} />
                  <Text style={[styles.sliderLabel, { color: theme.text + '80' }]}>
                    {t('speechEnhancer.quiet', 'Quiet')}
                  </Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={0.1}
                  maximumValue={0.5}
                  step={0.1}
                  value={vadSensitivity}
                  onValueChange={setVadSensitivity}
                  minimumTrackTintColor={theme.primary}
                  maximumTrackTintColor={theme.border}
                  thumbTintColor={theme.primary}
                />
                <View style={styles.sliderLabelContainer}>
                  <Ionicons name="volume-high-outline" size={16} color={theme.text + '80'} />
                  <Text style={[styles.sliderLabel, { color: theme.text + '80' }]}>
                    {t('speechEnhancer.noisy', 'Noisy')}
                  </Text>
                </View>
              </View>
              <Text style={[styles.vadSettingHelp, { color: theme.text + '60' }]}>
                {t('speechEnhancer.environmentNoiseHelp', 'In a quiet room, use lower setting. In noisy places, increase this to avoid false triggers')}
              </Text>
            </View>

            {/* Speaking Speed Setting */}
            <View style={styles.vadSettingItem}>
              <View style={styles.vadSettingHeader}>
                <Ionicons name="speedometer-outline" size={20} color={theme.text} />
                <Text style={[styles.vadSettingLabel, { color: theme.text }]}>
                  {t('speechEnhancer.speakingSpeed', 'Your Speaking Speed')}
                </Text>
              </View>
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelContainer}>
                  <Ionicons name="hourglass-outline" size={16} color={theme.text + '80'} />
                  <Text style={[styles.sliderLabel, { color: theme.text + '80' }]}>
                    {t('speechEnhancer.slowSpeaker', 'Slow')}
                  </Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={0.5}
                  maximumValue={2.0}
                  step={0.1}
                  value={vadSilenceDuration}
                  onValueChange={setVadSilenceDuration}
                  minimumTrackTintColor={theme.primary}
                  maximumTrackTintColor={theme.border}
                  thumbTintColor={theme.primary}
                />
                <View style={styles.sliderLabelContainer}>
                  <Ionicons name="flash-outline" size={16} color={theme.text + '80'} />
                  <Text style={[styles.sliderLabel, { color: theme.text + '80' }]}>
                    {t('general.fast', 'Fast')}
                  </Text>
                </View>
              </View>
              <Text style={[styles.vadSettingHelp, { color: theme.text + '60' }]}>
                {t('speechEnhancer.speakingSpeedHelp', 'Slow speakers: longer pauses. Fast speakers: shorter pauses. Currently: {{seconds}}s pause', { seconds: vadSilenceDuration.toFixed(1) })}
              </Text>
            </View>
          </View>
        )}

      </ScrollView>

      {/* Toast Notification */}
      {toastMessage && (
        <View style={styles.toastContainer}>
          <View style={[styles.toast, { backgroundColor: theme.primary }]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  modeSelector: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  statusCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  mainButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  pressToTalkButton: {
    transform: [{ scale: 1 }],
  },
  mainButtonLabel: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  processingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  processingText: {
    marginLeft: 8,
    fontSize: 14,
  },
  speakingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  speakingText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  waitingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
  waitingText: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  enhancementCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  enhancementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  enhancementInfo: {
    flex: 1,
    marginRight: 12,
  },
  enhancementTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  enhancementDesc: {
    fontSize: 14,
  },
  vadSettingsCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  vadSettingsDesc: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
    lineHeight: 18,
  },
  vadSettingItem: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  vadSettingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  vadSettingLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  vadSettingHelp: {
    fontSize: 12,
    marginTop: 8,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  slider: {
    flex: 1,
    marginHorizontal: 12,
    height: 40,
  },
  sliderLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 4,
  },
  sliderLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 60,
  },
  settingsCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  settingLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    marginLeft: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  historyCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    maxHeight: 400,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  clearButton: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 14,
    marginTop: 4,
  },
  phrasesList: {
    maxHeight: 300,
  },
  phraseItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  phraseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  phraseTime: {
    fontSize: 12,
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  confidenceBadgeText: {
    fontSize: 11,
    color: '#FF9800',
    marginLeft: 4,
    fontWeight: '600',
  },
  phraseText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  replayButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  warningCard: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  warningTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  warningText: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 16,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 12,
  },
  toastContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  qualityWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFF3E0',
  },
  qualityWarningText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#FF9800',
    fontWeight: '500',
  },
  diagnosticsCard: {
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  diagnosticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  diagnosticsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  diagnosticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  diagnosticItem: {
    width: '33.33%',
    paddingVertical: 8,
  },
  diagnosticLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  diagnosticValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  energyBarContainer: {
    marginTop: 8,
    marginBottom: 12,
  },
  energyBarBg: {
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  energyBar: {
    height: '100%',
    borderRadius: 12,
  },
  thresholdMarker: {
    position: 'absolute',
    top: 0,
    width: 3,
    height: '100%',
    opacity: 0.8,
  },
  energyBarLabel: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  meteringInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  meteringLabel: {
    fontSize: 12,
    marginRight: 6,
  },
  meteringValue: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  diagnosticsWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFF3E0',
  },
  diagnosticsWarningText: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
});

export default SpeechEnhancerScreen;

