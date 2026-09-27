import { useState, useCallback, useEffect } from 'react';
import { Alert, Platform, NativeEventEmitter, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { ttsService, TTSRequest } from '../services/ttsService';
import { apiService } from '../services/apiService';
import { authService } from '../services/authService';
import { API_CONFIG } from '../config/api';
import { audioRoutingService } from '../services/AudioRoutingService';
import { requestAudioPermissions } from '../utils/permissions';
import nativeAudioOutput from '../services/nativeAudioOutputService';
import i18next from 'i18next';
import { voiceSettingsService } from '../services/voiceSettingsService';

// Helper function to configure audio output device
const configureAudioOutput = async (device: string) => {
  try {
    console.log('[Audio] Configuring output device:', device);
    
    // FIRST: Try using native Android AudioManager (if available)
    // This provides TRUE speaker forcing that overrides Bluetooth
    if (Platform.OS === 'android' && nativeAudioOutput.isAvailable()) {
      console.log('[Audio] Using NATIVE Android AudioManager for routing');
      const nativeSuccess = await nativeAudioOutput.applyOutput(device);
      
      if (nativeSuccess) {
        console.log('[Audio] ✅ Native audio routing applied successfully for:', device);
        // Native routing successful - still set Expo AV mode for audio focus
      } else {
        console.warn('[Audio] ⚠️ Native routing failed, falling back to Expo AV');
      }
    } else if (Platform.OS === 'android') {
      console.log('[Audio] Native module not available, using Expo AV fallback');
    }
    
    // SECOND: Configure Expo AV audio mode (for audio focus and iOS)
    // Base configuration that applies to all modes
    // IMPORTANT: Use DUCK_OTHERS (2) instead of DO_NOT_MIX (1) to avoid AudioFocusNotAcquiredException
    let audioMode: any = {
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: 2, // DUCK_OTHERS - lower volume of other apps
      interruptionModeAndroid: 2, // DUCK_OTHERS - prevents AudioFocusNotAcquiredException
    };

    if (Platform.OS === 'android') {
      // SIMPLE APPROACH: Let native module handle routing
      // Just configure Expo AV for normal media playback
      audioMode.shouldDuckAndroid = false;
      audioMode.playThroughEarpieceAndroid = false; // NEVER use earpiece for media!
      console.log('[Audio] Expo AV: Android configured for NORMAL media playback');
      console.log('[Audio] Native module controls routing:', device);
    } else if (Platform.OS === 'ios') {
      switch (device) {
        case 'speaker':
          audioMode.allowsRecordingIOS = false;
          audioMode.interruptionModeIOS = 2;
          console.log('[Audio] Expo AV: iOS configured for SPEAKER');
          break;
        case 'earpiece':
          audioMode.allowsRecordingIOS = false;
          audioMode.interruptionModeIOS = 2;
          console.log('[Audio] Expo AV: iOS configured for EARPIECE');
          break;
        case 'bluetooth':
        case 'airplay':
          audioMode.allowsRecordingIOS = true;
          audioMode.interruptionModeIOS = 2;
          console.log('[Audio] Expo AV: iOS configured for BLUETOOTH/AIRPLAY');
          break;
      }
    }

    await Audio.setAudioModeAsync(audioMode);
    console.log('[Audio] ✅ Expo AV audio mode set:', JSON.stringify(audioMode));
    console.log('[Audio] ====================');
    console.log('[Audio] FINAL CONFIG - Device:', device);
    if (nativeAudioOutput.isAvailable()) {
      console.log('[Audio] Native routing: ENABLED (TRUE speaker control)');
    } else {
      console.log('[Audio] Native routing: DISABLED (Expo AV fallback - limited control)');
    }
    console.log('[Audio] ====================');
  } catch (error) {
    console.error('[Audio] Failed to configure audio output:', error);
    throw error;
  }
};

export interface UseTextToSpeechResult {
  isLoading: boolean;
  currentSound: Audio.Sound | null;
  isPlaying: boolean;
  error: string | null;
  generateSpeech: (request: TTSRequest) => Promise<Audio.Sound>;
  speak: (text: string, voiceId?: string, provider?: 'ELEVENLABS' | 'OPENAI', language?: string) => Promise<Audio.Sound>;
  previewVoice: (voiceId: string, provider: 'ELEVENLABS' | 'OPENAI', publicOwnerId?: string, voiceName?: string, language?: string) => Promise<Audio.Sound>;
  stopSpeaking: () => void;
  isAudioRoutingEnabled: boolean;
  toggleAudioRouting: (enabled: boolean) => Promise<boolean>;
  selectedAudioDevice: string;
  setAudioDevice: (device: string) => Promise<void>;
  forceAudioDevice: () => Promise<void>;
}

export const useTextToSpeech = (): UseTextToSpeechResult => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isAudioRoutingEnabled, setIsAudioRoutingEnabled] = useState<boolean>(false);

  // Track the selected audio device
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('speaker');

  // Initialize audio on mount
  useEffect(() => {
    (async () => {
      try {
        // Load saved audio device preference
        const savedDevice = await AsyncStorage.getItem('selectedAudioDevice');
        if (savedDevice) {
          setSelectedAudioDevice(savedDevice);
        }
        
        // Initialize Audio with default settings
        await configureAudioOutput(savedDevice || 'speaker');
      } catch (error) {
        console.error('Failed to initialize audio:', error);
      }
    })();
  }, []);

  // Load audio routing preference on mount
  useEffect(() => {
    const loadAudioRoutingPreference = async () => {
      try {
        // Load from local storage (device-specific preference)
        const savedRouting = await AsyncStorage.getItem('audioRoutingEnabled');
        const routingEnabled = savedRouting ? JSON.parse(savedRouting) : false;
        
        // Initialize the audio routing service with this value
        await audioRoutingService.setAudioRoutingEnabled(routingEnabled);
        
        // Set local state
        setIsAudioRoutingEnabled(routingEnabled);
        console.log('[Audio] Loaded audio routing preference from local storage:', routingEnabled);
      } catch (error) {
        console.error('Failed to load audio routing preference:', error);
        // Fallback to default
        setIsAudioRoutingEnabled(false);
      }
    };
    
    loadAudioRoutingPreference();
  }, []);

  // Listen for native audio playback completion events
  useEffect(() => {
    if (Platform.OS === 'android' && nativeAudioOutput.isAvailable()) {
      const eventEmitter = new NativeEventEmitter(NativeModules.AudioOutput);
      
      const subscription = eventEmitter.addListener('onAudioPlaybackComplete', () => {
        console.log('[Audio] Native playback completed - received event from native module');
        setIsPlaying(false);
        setIsLoading(false);
      });
      
      return () => {
        subscription.remove();
      };
    }
  }, []);

  const stopSpeaking = useCallback(async () => {
    if (currentSound) {
      console.log('Stopping current sound playback');
      try {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
      } catch (error) {
        console.error('Error stopping sound:', error);
      }
      setCurrentSound(null);
      setIsPlaying(false);
    }
    
    // Also stop any audio routing
    audioRoutingService.stopAudioRouting();
  }, [currentSound]);

  const generateSpeech = useCallback(async (request: TTSRequest): Promise<Audio.Sound> => {
    console.log('useTextToSpeech.generateSpeech called with:', {
      textLength: request.text.length,
      textStart: request.text.substring(0, 20) + (request.text.length > 20 ? '...' : ''),
      voiceId: request.voiceId,
      provider: request.provider,
      audioRoutingEnabled: isAudioRoutingEnabled
    });
    
    try {
      // Stop any current playback
      await stopSpeaking();
      
      // CRITICAL: Reload device preference from AsyncStorage BEFORE each playback
      // This ensures we use the latest user selection even if they changed it in settings
      const currentDevice = await AsyncStorage.getItem('selectedAudioDevice');
      const deviceToUse = currentDevice || selectedAudioDevice || 'speaker';
      console.log('[Audio] Loaded current device preference:', deviceToUse);
      
      // Force audio output device before playing
      await configureAudioOutput(deviceToUse);
      console.log('[Audio] Forced audio device configuration before playback');
      
      setIsLoading(true);
      setError(null);
      
      // Check if audio routing is enabled
      if (isAudioRoutingEnabled) {
        console.log('Audio routing is enabled, using special flow');
        
        // Create a Promise for the audio data
        const audioDataPromise = new Promise<ArrayBuffer>(async (resolve, reject) => {
          try {
            // Call TTS API with a direct fetch to handle binary data
            // First get auth headers
            const token = await authService.getToken();
            console.log('Auth token obtained:', !!token);
            
            const headers: HeadersInit = {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token?.access_token || ''}`
            };
            
            console.log('Making API request to:', `${API_CONFIG.BASE_URL}/api/tts`);
            
            // Make direct fetch request to handle binary data
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/tts`, {
              method: 'POST',
              headers,
              body: JSON.stringify(request)
            });
            
            if (!response.ok) {
              throw new Error(`API error: ${response.status}`);
            }
            
            // Get the response as arraybuffer
            const audioData = await response.arrayBuffer();
            resolve(audioData);
          } catch (error) {
            reject(error);
          }
        });
        
        // Get the audio data
        const audioData = await audioDataPromise;
        
        // Route audio to microphone
        await audioRoutingService.routeAudioToMicrophone(audioData);
        
        // Create a dummy sound to satisfy the return type
        const dummySound = new Audio.Sound();
        setCurrentSound(null);
        setIsPlaying(true);
        return dummySound;
      } else {
        // Normal flow using the TTS service
        console.log('Calling ttsService.generateSpeech...');
        const sound = await ttsService.generateSpeech(request);
        console.log('ttsService.generateSpeech returned successfully');
        
        // Re-check the current device preference in case it changed
        const finalDevice = await AsyncStorage.getItem('selectedAudioDevice') || deviceToUse;
        
        // DECISION POINT: Use native playback for Android speaker mode, Expo AV for everything else
        const useNativePlayback = Platform.OS === 'android' && finalDevice === 'speaker' && nativeAudioOutput.isAvailable();
        
        if (useNativePlayback) {
          console.log('[Audio] 🎯 Using NATIVE PLAYBACK (no Expo AV interference!)');
          
          // Apply native speaker routing BEFORE playback
          await configureAudioOutput(finalDevice);
          
          // Get the file path from the TTS cache
          const audioFilePath = `${FileSystem.cacheDirectory}tts_output.mp3`;
          console.log('[Audio] Playing audio file via native module:', audioFilePath);
          
          // Play using native MediaPlayer - this keeps MODE_IN_COMMUNICATION stable!
          const playbackResult = await nativeAudioOutput.playAudio(audioFilePath);
          
          if (!playbackResult) {
            console.error('[Audio] Native playback failed, falling back to Expo AV');
            // Fallback to Expo AV if native fails
            setCurrentSound(sound);
            setIsPlaying(true);
            sound.setOnPlaybackStatusUpdate((status) => {
              if (status.isLoaded && status.didJustFinish) {
                console.log('Sound playback completed');
                setIsPlaying(false);
                setCurrentSound(null);
                sound.unloadAsync().catch(error => console.error('Error unloading sound:', error));
              }
            });
            await sound.playAsync();
          } else {
            console.log('[Audio] ✅ Native playback started successfully - MODE_IN_COMMUNICATION will remain stable!');
            // For native playback, we don't use the Expo Sound object
            // Instead, monitor completion via a timer (native module handles completion)
            setCurrentSound(null);
            setIsPlaying(true);
            
            // Unload the Expo Sound since we're not using it
            sound.unloadAsync().catch(error => console.error('Error unloading unused sound:', error));
            
            // Set up a listener to detect when native playback finishes
            // We'll poll the playback status or rely on the native module's completion callback
            // For now, we'll rely on the native module logging completion
            // The app can manually stop or the user can play another sound
          }
          
          return sound; // Return the sound object for API compatibility
        } else {
          console.log('[Audio] Using EXPO AV playback for device:', finalDevice);
          
          // Store the sound reference
          setCurrentSound(sound);
          
          // Play the sound
          console.log('Playing sound...');
          setIsPlaying(true);
          
          // Set up event listener for playback status
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded) {
              if (status.didJustFinish) {
                console.log('Sound playback completed');
                setIsPlaying(false);
                setCurrentSound(null);
                sound.unloadAsync().catch(error => {
                  console.error('Error unloading sound:', error);
                });
              }
            }
          });
          
          // CRITICAL: Re-apply audio configuration RIGHT before playback
          await configureAudioOutput(finalDevice);
          console.log('[Audio] Audio mode re-applied immediately before playback with device:', finalDevice);
          
          // Start playback with error handling for audio focus issues
          try {
            await sound.playAsync();
            console.log('[Audio] Sound playback started successfully');
          } catch (playbackError: any) {
            // Check if it's an audio focus error
            if (playbackError.message?.includes('AudioFocusNotAcquiredException')) {
              console.error('[Audio] Audio focus not acquired. Trying with MIX_WITH_OTHERS mode...');
              
              // Fallback: Try with more permissive audio mode (MIX_WITH_OTHERS)
              try {
                const fallbackMode: any = {
                  playsInSilentModeIOS: true,
                  staysActiveInBackground: true,
                  interruptionModeIOS: 0, // MIX_WITH_OTHERS
                  interruptionModeAndroid: 0, // MIX_WITH_OTHERS
                  shouldDuckAndroid: false,
                  playThroughEarpieceAndroid: false,
                };
                await Audio.setAudioModeAsync(fallbackMode);
                console.log('[Audio] Fallback mode applied (MIX_WITH_OTHERS)');
                
                // Retry playback
                await sound.playAsync();
                console.log('[Audio] Sound playback started with fallback mode');
              } catch (fallbackError) {
                console.error('[Audio] Fallback playback also failed:', fallbackError);
                throw new Error('Unable to play audio. Another app may be using the audio output. Please pause other media apps and try again.');
              }
            } else {
              // Re-throw if it's a different error
              throw playbackError;
            }
          }
          
          return sound;
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate speech';
      console.error('Error in text-to-speech generateSpeech:', errorMessage, err);
      setError(errorMessage);
      setIsPlaying(false);
      setCurrentSound(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [stopSpeaking, isAudioRoutingEnabled, selectedAudioDevice]);

  const speak = useCallback(async (
    text: string, 
    voiceId?: string, 
    provider?: 'ELEVENLABS' | 'OPENAI',
    language?: string
  ): Promise<Audio.Sound> => {
    console.log('useTextToSpeech.speak called with:', {
      textLength: text.length,
      textStart: text.substring(0, 20) + (text.length > 20 ? '...' : ''),
      voiceId: voiceId || 'undefined',
      provider: provider || 'undefined',
      language: language || 'undefined',
      audioRoutingEnabled: isAudioRoutingEnabled
    });
    
    try {
      // Load user's saved modelId from database
      let savedModelId: string | undefined;
      try {
        const userSettings = await voiceSettingsService.getUserSettings();
        savedModelId = userSettings?.voiceSettings?.modelId;
        if (savedModelId) {
          console.log('[TTS] Using saved modelId from database:', savedModelId);
        }
      } catch (err) {
        console.log('[TTS] Could not load modelId from settings:', err);
      }
      
      // Build request with optional parameters
      const request: TTSRequest = {
        text
      };
      
      // Only add fields if they're defined
      if (voiceId) request.voiceId = voiceId;
      if (provider) request.provider = provider;
      if (savedModelId) request.modelId = savedModelId; // Add modelId from database
      if (language) {
        request.settings = {
          ...(request.settings || {}),
          language
        };
      }
      
      return generateSpeech(request);
    } catch (error) {
      console.error('Error in useTextToSpeech.speak:', error);
      throw error;
    }
  }, [generateSpeech, isAudioRoutingEnabled]);

  // Function to toggle audio routing
  const toggleAudioRouting = useCallback(async (enabled: boolean): Promise<boolean> => {
    try {
      // Request permissions if enabling
      if (enabled) {
        const permissionsGranted = await requestAudioPermissions();
        if (!permissionsGranted) {
          Alert.alert(
            'Permissions Required',
            'Audio routing requires microphone and audio settings permissions',
            [{ text: 'OK' }]
          );
          return false;
        }
      }
      
      // Update service
      const success = await audioRoutingService.setAudioRoutingEnabled(enabled);
      
      if (success) {
        // Save preference locally only (device-specific, not synced to backend)
        await AsyncStorage.setItem('audioRoutingEnabled', JSON.stringify(enabled));
        console.log('[Audio] Audio routing preference saved locally:', enabled);
        
        // Update local state
        setIsAudioRoutingEnabled(enabled);
      }
      
      return success;
    } catch (error) {
      console.error('Failed to toggle audio routing:', error);
      return false;
    }
  }, []);

  // New function for previewing voices using /api/voice-preview endpoint
  const previewVoice = useCallback(async (
    voiceId: string,
    provider: 'ELEVENLABS' | 'OPENAI',
    publicOwnerId?: string,
    voiceName?: string,
    language?: string
  ): Promise<Audio.Sound> => {
    try {
      // Stop any current playback
      await stopSpeaking();
      
      // Reload device preference from AsyncStorage to get latest user selection
      const currentDevice = await AsyncStorage.getItem('selectedAudioDevice') || selectedAudioDevice || 'speaker';
      console.log('[Audio] Preview - Loaded current device preference:', currentDevice);
      
      // Force audio output device before playing
      await configureAudioOutput(currentDevice);
      console.log('[Audio] Forced audio device configuration before preview playback');
      
      setIsLoading(true);
      setError(null);
      
      // Generate a random number between 1 and 4 to select one of the preview texts
      const previewTextNumber = Math.floor(Math.random() * 4) + 1;
      const previewText = i18next.t(`voice.preview.text-${previewTextNumber}`);
      
      // Get current language if none provided
      const currentLanguage = language || i18next.language;
      
      // Check if audio routing is enabled
      if (isAudioRoutingEnabled) {
        // Call preview API with audio routing
        const response = await apiService.post<{
          audioData: string;
          format: string;
          metadata: any;
        }>('/api/voice-preview', {
          voiceId,
          provider,
          text: previewText,
          publicOwnerId,
          voiceName,
          lang: currentLanguage
        });
        
        if (!response.audioData) {
          throw new Error('No audio data received');
        }
        
        // Convert base64 to ArrayBuffer
        const binaryString = atob(response.audioData);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Route audio to microphone
        await audioRoutingService.routeAudioToMicrophone(bytes.buffer);
        
        // Create a dummy sound to satisfy the return type
        const dummySound = new Audio.Sound();
        setCurrentSound(null);
        setIsPlaying(true);
        
        // Only now clear the loading state after audio routing has begun
        setIsLoading(false);
        
        return dummySound;
      } else {
        // Normal preview flow
        const response = await apiService.post<{
          audioData: string;
          format: string;
          metadata: any;
        }>('/api/voice-preview', {
          voiceId,
          provider,
          text: previewText,
          publicOwnerId,
          voiceName,
          lang: currentLanguage
        });
        
        if (!response.audioData) {
          throw new Error('No audio data received');
        }
        
        // Create a temporary file and write the audio data to it
        const filePath = `${FileSystem.cacheDirectory}voice_preview_${voiceId}.mp3`;
        
        // Write base64 audio data to file
        await FileSystem.writeAsStringAsync(filePath, response.audioData, {
          encoding: FileSystem.EncodingType.Base64
        });
        
        // IMPORTANT: Keep isLoading true here, we'll set it to false only when audio is actually playing
        console.log('Before createAsync - keeping isLoading state:', isLoading);
        
        // Load the sound file using expo-av
        const { sound } = await Audio.Sound.createAsync(
          { uri: filePath },
          { shouldPlay: true },
          // Add onPlaybackStatusUpdate directly in the creation to catch initial loading too
          (status) => {
            if (status.isLoaded) {
              // Only set isPlaying true and clear loading state once playback has actually started
              if (status.isPlaying) {
                console.log('Audio is now playing, clearing loading state');
                setIsPlaying(true);
                setIsLoading(false);
              }
              
              if (status.didJustFinish) {
                console.log('Voice preview playback completed');
                setIsPlaying(false);
                setCurrentSound(null);
                sound.unloadAsync().catch(error => {
                  console.error('Error unloading sound:', error);
                });
              }
            }
          }
        );
        
        // Store the sound reference but DON'T set isPlaying true yet
        // We only want to set that when audio actually starts playing
        setCurrentSound(sound);
        
        return sound;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview voice');
      console.error('Error in voice preview:', err);
      
      // Always clear loading state on error
      setIsLoading(false);
      
      throw err;
    }
  }, [stopSpeaking, isAudioRoutingEnabled, selectedAudioDevice]);

  // Function to set and save audio device
  const setAudioDevice = useCallback(async (device: string) => {
    try {
      console.log('[Audio] Setting audio device to:', device);
      await configureAudioOutput(device);
      setSelectedAudioDevice(device);
      await AsyncStorage.setItem('selectedAudioDevice', device);
      
      // Note: We don't save to voice settings as audioOutputDevice is not part of the schema
      // It's saved locally in AsyncStorage only
    } catch (error) {
      console.error('Failed to set audio device:', error);
      throw error;
    }
  }, []);

  // Function to force the current audio device configuration
  const forceAudioDevice = useCallback(async () => {
    try {
      // Always reload the latest device preference from AsyncStorage
      const currentDevice = await AsyncStorage.getItem('selectedAudioDevice') || selectedAudioDevice || 'speaker';
      console.log('[Audio] Forcing audio device configuration:', currentDevice);
      await configureAudioOutput(currentDevice);
    } catch (error) {
      console.error('Failed to force audio device:', error);
      throw error;
    }
  }, [selectedAudioDevice]);

  return {
    isLoading,
    currentSound,
    isPlaying,
    error,
    generateSpeech,
    speak,
    previewVoice,
    stopSpeaking,
    isAudioRoutingEnabled,
    toggleAudioRouting,
    selectedAudioDevice,
    setAudioDevice,
    forceAudioDevice
  };
}; 