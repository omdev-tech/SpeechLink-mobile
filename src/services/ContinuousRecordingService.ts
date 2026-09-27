/**
 * Continuous Recording Service
 * 
 * Provides intelligent voice activity detection (VAD) for continuous speech recording.
 * Detects when user starts/stops speaking and processes audio chunks automatically.
 * 
 * Features:
 * - Silence detection with configurable thresholds
 * - Echo cancellation (ignores audio while TTS is playing)
 * - Minimum phrase duration filtering
 * - Asynchronous chunk processing
 * 
 * @module ContinuousRecordingService
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Configuration for Voice Activity Detection
 */
export interface VADConfig {
  /** Duration of silence (ms) that ends a phrase */
  silenceDuration: number;
  /** Minimum phrase length (ms) to be processed */
  minPhraseDuration: number;
  /** Audio energy threshold for voice detection (0.0-1.0) */
  energyThreshold: number;
  /** Update interval for audio metering (ms) */
  meteringInterval: number;
  /** Enable adaptive threshold adjustment */
  adaptiveThreshold: boolean;
  /** Enable detailed debug logging */
  debugMode: boolean;
}

/**
 * VAD Diagnostics for real-time monitoring
 */
export interface VADDiagnostics {
  isListening: boolean;
  isSpeaking: boolean;
  currentEnergy: number;
  threshold: number;
  phraseDuration: number;
  chunkCount: number;
  lastMeteringValue: number;
  meteringCallbackCount: number;
}

/**
 * Default VAD configuration optimized for speech impairment users
 * Based on real-world testing: silence is typically < 20% energy
 */
const DEFAULT_VAD_CONFIG: VADConfig = {
  silenceDuration: 500,      // 500ms (0.5s) silence ends phrase - faster chunk sending
  minPhraseDuration: 300,    // 300ms minimum phrase (catch short words/sounds)
  energyThreshold: 0.20,     // 20% threshold - real-world calibrated (silence < 20%)
  meteringInterval: 80,      // Check audio levels every 80ms (more responsive)
  adaptiveThreshold: true,   // Enable adaptive threshold
  debugMode: true            // Enable debugging initially
};

/**
 * Callback when a complete phrase is detected
 * @param audioUri - File URI of the recorded audio
 * @returns Promise that resolves when processing is complete
 */
export type PhraseDetectedCallback = (audioUri: string) => Promise<void>;

/**
 * Continuous Recording Service
 * 
 * Manages continuous audio recording with automatic phrase detection.
 * Processes audio chunks asynchronously without blocking new recordings.
 */
export class ContinuousRecordingService {
  private recording: Audio.Recording | null = null;
  private isListening = false;
  private isSpeaking = false;
  private isTTSPlaying = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private phraseStartTime: number = 0;
  private config: VADConfig;
  private onPhraseDetected: PhraseDetectedCallback | null = null;
  private recordingCounter = 0;
  private energySamples: number[] = []; // Track energy levels during recording
  private maxEnergyDetected: number = 0; // Track max energy in current phrase
  
  // Adaptive threshold tracking
  private recentEnergyLevels: number[] = []; // Rolling window of energy levels
  private adaptiveThreshold: number;
  private baselineNoiseLevel: number = 0;
  
  // Diagnostics
  private meteringCallbackCount: number = 0;
  private lastMeteringValue: number = -160;
  private currentEnergy: number = 0;
  private diagnosticsListeners: Array<(diag: VADDiagnostics) => void> = [];
  
  // Watchdog timer to detect stuck callbacks
  private callbackWatchdog: NodeJS.Timeout | null = null;
  private lastCallbackTime: number = 0;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.adaptiveThreshold = this.config.energyThreshold;
    
    if (this.config.debugMode) {
      console.log('[ContinuousRecording] Initialized with config:', this.config);
    }
  }

  /**
   * Start continuous recording mode
   * @param callback - Called when a complete phrase is detected
   */
  async startContinuousMode(callback: PhraseDetectedCallback): Promise<void> {
    if (this.isListening) {
      console.warn('[ContinuousRecording] Already listening');
      return;
    }

    this.onPhraseDetected = callback;
    this.isListening = true;
    this.isSpeaking = false;
    this.recordingCounter = 0;
    
    // Reset diagnostics counters
    this.meteringCallbackCount = 0;
    this.recentEnergyLevels = [];
    this.energySamples = [];
    this.maxEnergyDetected = 0;
    this.adaptiveThreshold = this.config.energyThreshold;
    this.baselineNoiseLevel = 0;

    console.log('[ContinuousRecording] Starting continuous mode with config:', this.config);

    // Request audio permissions
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Microphone permission not granted');
    }

    // Setup audio mode for recording
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      interruptionModeIOS: 2, // DUCK_OTHERS
      interruptionModeAndroid: 2,
    });

    // Start first recording session
    await this.startRecordingSession();
    
    console.log('[ContinuousRecording] ✅ Listening for speech... Speak and wait 0.5s silence to send chunk');
  }

  /**
   * Start a new recording session with metering enabled
   */
  private async startRecordingSession(): Promise<void> {
    try {
      const { recording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          android: {
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          ios: {
            extension: '.m4a',
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          isMeteringEnabled: true, // Enable audio level monitoring
        },
        // Status update callback for VAD
        (status) => this.onRecordingStatusUpdate(status),
        this.config.meteringInterval
      );

      this.recording = recording;
      console.log('[ContinuousRecording] Recording session started');
      
      // Start watchdog to detect if callbacks stop
      this.startCallbackWatchdog();
    } catch (error) {
      console.error('[ContinuousRecording] Failed to start recording:', error);
      throw error;
    }
  }
  
  /**
   * Start a watchdog timer to detect if metering callbacks stop
   */
  private startCallbackWatchdog(): void {
    // Clear existing watchdog
    if (this.callbackWatchdog) {
      clearInterval(this.callbackWatchdog);
    }
    
    this.lastCallbackTime = Date.now();
    
    // Check every 2 seconds if callbacks are still coming
    this.callbackWatchdog = setInterval(() => {
      const timeSinceLastCallback = Date.now() - this.lastCallbackTime;
      
      // If no callback in 1 second (should be every 80ms), something is wrong
      if (timeSinceLastCallback > 1000 && this.isListening) {
        console.error(`[ContinuousRecording] ❌ Metering callbacks stopped! Last callback ${timeSinceLastCallback}ms ago`);
        console.error(`[ContinuousRecording] Total callbacks received: ${this.meteringCallbackCount}`);
        console.error(`[ContinuousRecording] Recording active: ${this.recording !== null}`);
        
        // Try to check recording status
        if (this.recording) {
          this.recording.getStatusAsync().then(status => {
            console.error(`[ContinuousRecording] Recording status:`, {
              isRecording: status.isRecording,
              isDoneRecording: status.isDoneRecording,
              durationMillis: status.durationMillis,
              metering: status.metering
            });
          }).catch(err => {
            console.error(`[ContinuousRecording] Failed to get status:`, err);
          });
        }
      }
    }, 2000);
  }
  
  /**
   * Stop the callback watchdog
   */
  private stopCallbackWatchdog(): void {
    if (this.callbackWatchdog) {
      clearInterval(this.callbackWatchdog);
      this.callbackWatchdog = null;
    }
  }

  /**
   * Handle recording status updates for voice activity detection
   */
  private onRecordingStatusUpdate(status: Audio.RecordingStatus): void {
    try {
      // Update watchdog
      this.lastCallbackTime = Date.now();
      
      if (!status.isRecording || !this.isListening) {
        if (this.config.debugMode && this.meteringCallbackCount <= 15) {
          console.log(`[ContinuousRecording] Callback skipped - isRecording: ${status.isRecording}, isListening: ${this.isListening}`);
        }
        return;
      }

      // Increment callback counter for diagnostics
      this.meteringCallbackCount++;
      
      // Get audio level from metering
      const audioLevel = status.metering !== undefined ? status.metering : -160;
      this.lastMeteringValue = audioLevel;
    
    // Normalize to 0.0-1.0 range (metering is in dB, typically -160 to 0)
    const normalizedLevel = Math.max(0, Math.min(1, (audioLevel + 160) / 160));
    this.currentEnergy = normalizedLevel;
    
    // Log first few callbacks for debugging
    if (this.config.debugMode && this.meteringCallbackCount <= 10) {
      console.log(`[ContinuousRecording] Callback #${this.meteringCallbackCount} - Metering: ${audioLevel.toFixed(2)} dB, Normalized: ${normalizedLevel.toFixed(4)}`);
    }
    
    // Track recent energy levels for adaptive threshold
    this.recentEnergyLevels.push(normalizedLevel);
    if (this.recentEnergyLevels.length > 50) {
      this.recentEnergyLevels.shift(); // Keep last 50 samples (~ 4 seconds)
    }
    
    // Update adaptive threshold if enabled
    if (this.config.adaptiveThreshold && this.recentEnergyLevels.length > 20) {
      this.updateAdaptiveThreshold();
    }
    
    // Use adaptive threshold if available, otherwise use config threshold
    const effectiveThreshold = this.config.adaptiveThreshold 
      ? this.adaptiveThreshold 
      : this.config.energyThreshold;
    
    // Detect speech using threshold
    const isSpeechDetected = normalizedLevel > effectiveThreshold;
    
    // Skip if TTS is playing (echo cancellation)
    if (this.isTTSPlaying) {
      if (this.isSpeaking) {
        if (this.config.debugMode) {
          console.log('[ContinuousRecording] 🔇 TTS playing, pausing speech detection');
        }
        this.isSpeaking = false;
        
        // Clear silence timer when TTS interrupts
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      }
      
      // Update diagnostics
      this.updateDiagnostics();
      return;
    }

    if (isSpeechDetected) {
      // Speech detected
      if (!this.isSpeaking) {
        const confidenceLevel = ((normalizedLevel - effectiveThreshold) / effectiveThreshold * 100).toFixed(0);
        console.log(`[ContinuousRecording] 🎤 Speech started (energy: ${normalizedLevel.toFixed(4)}, threshold: ${effectiveThreshold.toFixed(4)}, confidence: +${confidenceLevel}%)`);
        
        this.isSpeaking = true;
        this.phraseStartTime = Date.now();
        this.energySamples = [];
        this.maxEnergyDetected = 0;
      }
      
      // Track energy samples for quality assessment
      this.energySamples.push(normalizedLevel);
      if (normalizedLevel > this.maxEnergyDetected) {
        this.maxEnergyDetected = normalizedLevel;
      }
      
      // Clear any pending silence timer (speech resumed)
      if (this.silenceTimer) {
        if (this.config.debugMode) {
          console.log(`[ContinuousRecording] 🔄 Speech resumed, canceling silence timer`);
        }
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else if (this.isSpeaking) {
      // Silence detected while user was speaking
      if (!this.silenceTimer) {
        const phraseDuration = Date.now() - this.phraseStartTime;
        console.log(`[ContinuousRecording] 🔇 Silence detected (energy: ${normalizedLevel.toFixed(4)} < ${effectiveThreshold.toFixed(4)}) after ${phraseDuration}ms speech, starting ${this.config.silenceDuration}ms timer`);
        
        // Start silence timer
        this.silenceTimer = setTimeout(() => {
          console.log(`[ContinuousRecording] ⏰ Silence timer completed (${this.config.silenceDuration}ms), ending phrase...`);
          this.endPhrase();
        }, this.config.silenceDuration);
      }
    }
    
      // Update diagnostics
      this.updateDiagnostics();
    } catch (error) {
      console.error('[ContinuousRecording] Error in onRecordingStatusUpdate:', error);
      // Don't throw - we don't want to break the callback chain
    }
  }
  
  /**
   * Update adaptive threshold based on recent audio levels
   * Uses a percentile-based approach to distinguish speech from noise
   */
  private updateAdaptiveThreshold(): void {
    if (this.recentEnergyLevels.length < 20) return;
    
    // Only use silence periods for noise calculation (exclude current speech)
    const silenceSamples = this.isSpeaking 
      ? this.recentEnergyLevels.slice(0, -Math.max(5, this.energySamples.length)) // Exclude current speech
      : this.recentEnergyLevels;
    
    if (silenceSamples.length < 10) {
      // Not enough silence samples yet, use default
      return;
    }
    
    // Calculate baseline noise level (20th percentile of silence samples)
    const sorted = [...silenceSamples].sort((a, b) => a - b);
    const noisePercentile = Math.floor(sorted.length * 0.2);
    const calculatedNoise = sorted[noisePercentile] || 0;
    
    // Sanity check: noise should be low (< 5%)
    if (calculatedNoise > 0.05) {
      console.warn(`[ContinuousRecording] ⚠️ Very high noise detected: ${(calculatedNoise * 100).toFixed(1)}% - environment may be too noisy`);
      this.baselineNoiseLevel = 0.02; // Use conservative default
    } else {
      this.baselineNoiseLevel = calculatedNoise;
    }
    
    // Set adaptive threshold as noise level + margin
    // For speech impairment users, use a smaller margin above noise
    const noiseMargin = 0.03; // 3% margin above noise to catch weak voices
    const calculatedThreshold = this.baselineNoiseLevel + noiseMargin;
    
    // Clamp between minimum and maximum thresholds
    const MIN_THRESHOLD = 0.15; // Don't go too low (avoid false triggers) - 15% minimum
    const MAX_THRESHOLD = 0.30; // Don't go too high (must catch weak voices) - 30% maximum
    
    const previousThreshold = this.adaptiveThreshold;
    this.adaptiveThreshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, calculatedThreshold));
    
    // Log threshold updates occasionally
    if (this.config.debugMode && this.meteringCallbackCount % 50 === 0) {
      console.log(`[ContinuousRecording] 📊 Adaptive threshold: ${this.adaptiveThreshold.toFixed(4)} (noise baseline: ${this.baselineNoiseLevel.toFixed(4)}, ${silenceSamples.length} silence samples)`);
      if (previousThreshold !== this.adaptiveThreshold) {
        console.log(`[ContinuousRecording] 🔄 Threshold adjusted: ${previousThreshold.toFixed(4)} → ${this.adaptiveThreshold.toFixed(4)}`);
      }
    }
  }
  
  /**
   * Update diagnostics and notify listeners
   */
  private updateDiagnostics(): void {
    const diagnostics: VADDiagnostics = {
      isListening: this.isListening,
      isSpeaking: this.isSpeaking,
      currentEnergy: this.currentEnergy,
      threshold: this.config.adaptiveThreshold ? this.adaptiveThreshold : this.config.energyThreshold,
      phraseDuration: this.isSpeaking ? Date.now() - this.phraseStartTime : 0,
      chunkCount: this.recordingCounter,
      lastMeteringValue: this.lastMeteringValue,
      meteringCallbackCount: this.meteringCallbackCount,
    };
    
    // Notify all listeners
    this.diagnosticsListeners.forEach(listener => {
      try {
        listener(diagnostics);
      } catch (error) {
        console.error('[ContinuousRecording] Error in diagnostics listener:', error);
      }
    });
  }

  /**
   * End current phrase and process audio
   */
  private async endPhrase(): Promise<void> {
    console.log(`[ContinuousRecording] 📝 endPhrase() called`);
    
    const phraseDuration = Date.now() - this.phraseStartTime;
    
    // Check minimum duration
    if (phraseDuration < this.config.minPhraseDuration) {
      console.log(`[ContinuousRecording] ⏭️ Phrase too short (${phraseDuration}ms < ${this.config.minPhraseDuration}ms), ignoring`);
      this.isSpeaking = false;
      this.silenceTimer = null;
      this.energySamples = [];
      this.maxEnergyDetected = 0;
      return;
    }

    // Check audio quality - skip if it's just noise or very weak
    const averageEnergy = this.energySamples.length > 0
      ? this.energySamples.reduce((a, b) => a + b, 0) / this.energySamples.length
      : 0;

    // Dynamic quality thresholds based on adaptive threshold
    const effectiveThreshold = this.config.adaptiveThreshold ? this.adaptiveThreshold : this.config.energyThreshold;
    const MIN_AVERAGE_ENERGY = effectiveThreshold * 1.2; // Average should be 20% above threshold
    const MIN_MAX_ENERGY = effectiveThreshold * 1.5; // Peak should be 50% above threshold
    const MIN_ENERGY_SAMPLES = 3; // Need at least 3 samples of speech

    if (averageEnergy < MIN_AVERAGE_ENERGY || 
        this.maxEnergyDetected < MIN_MAX_ENERGY || 
        this.energySamples.length < MIN_ENERGY_SAMPLES) {
      console.log(`[ContinuousRecording] ⏭️ Audio quality too low, skipping:`, {
        duration: phraseDuration,
        avgEnergy: averageEnergy.toFixed(4),
        minAvgRequired: MIN_AVERAGE_ENERGY.toFixed(4),
        maxEnergy: this.maxEnergyDetected.toFixed(4),
        minMaxRequired: MIN_MAX_ENERGY.toFixed(4),
        samples: this.energySamples.length,
        minSamplesRequired: MIN_ENERGY_SAMPLES
      });
      this.isSpeaking = false;
      this.silenceTimer = null;
      this.energySamples = [];
      this.maxEnergyDetected = 0;
      return;
    }

    console.log(`[ContinuousRecording] ✅ Phrase ended (${phraseDuration}ms)`, {
      avgEnergy: averageEnergy.toFixed(4),
      maxEnergy: this.maxEnergyDetected.toFixed(4),
      samples: this.energySamples.length,
      threshold: effectiveThreshold.toFixed(4)
    });
    
    this.isSpeaking = false;
    this.silenceTimer = null;
    
    // Reset energy tracking for next phrase
    const energyStats = {
      average: averageEnergy,
      max: this.maxEnergyDetected,
      samples: this.energySamples.length,
      threshold: effectiveThreshold
    };
    this.energySamples = [];
    this.maxEnergyDetected = 0;

    if (!this.recording) {
      console.warn('[ContinuousRecording] No active recording');
      return;
    }

    try {
      // Get current recording URI
      const uri = this.recording.getURI();
      
      // Stop current recording
      await this.recording.stopAndUnloadAsync();
      this.recording = null;

      // Process chunk asynchronously (don't wait)
      if (uri && this.onPhraseDetected) {
        this.recordingCounter++;
        const chunkId = this.recordingCounter;
        console.log(`[ContinuousRecording] 📦 Processing chunk #${chunkId}`, energyStats);
        
        this.processChunkAsync(uri, chunkId).catch(error => {
          console.error(`[ContinuousRecording] Error processing chunk #${chunkId}:`, error);
        });
      }

      // Immediately start new recording session (continuous)
      if (this.isListening) {
        await this.startRecordingSession();
      }
    } catch (error) {
      console.error('[ContinuousRecording] Error in endPhrase:', error);
      
      // Try to recover by starting a new session
      if (this.isListening) {
        try {
          await this.startRecordingSession();
        } catch (recoveryError) {
          console.error('[ContinuousRecording] Failed to recover:', recoveryError);
        }
      }
    }
  }

  /**
   * Process audio chunk asynchronously
   * Runs in background without blocking new recordings
   */
  private async processChunkAsync(audioUri: string, chunkId: number): Promise<void> {
    try {
      console.log(`[ContinuousRecording] ⏳ Processing chunk #${chunkId}...`);
      
      if (this.onPhraseDetected) {
        await this.onPhraseDetected(audioUri);
      }
      
      console.log(`[ContinuousRecording] ✅ Chunk #${chunkId} processed successfully`);
      
      // Clean up temporary file
      try {
        await FileSystem.deleteAsync(audioUri, { idempotent: true });
      } catch (cleanupError) {
        console.warn(`[ContinuousRecording] Failed to cleanup chunk #${chunkId}:`, cleanupError);
      }
    } catch (error) {
      console.error(`[ContinuousRecording] ❌ Failed to process chunk #${chunkId}:`, error);
    }
  }

  /**
   * Notify service that TTS is playing
   * Used for echo cancellation
   * @param playing - true if TTS started, false if stopped
   */
  setTTSPlaying(playing: boolean): void {
    this.isTTSPlaying = playing;
    console.log(`[ContinuousRecording] 🔊 TTS ${playing ? 'started' : 'stopped'}`);
  }

  /**
   * Update VAD configuration
   * @param config - Partial config to update
   */
  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[ContinuousRecording] Config updated:', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): VADConfig {
    return { ...this.config };
  }

  /**
   * Check if currently listening
   */
  isActive(): boolean {
    return this.isListening;
  }

  /**
   * Check if currently detecting speech
   */
  isDetectingSpeech(): boolean {
    return this.isSpeaking;
  }

  /**
   * Subscribe to real-time diagnostics updates
   * @param listener - Callback function that receives diagnostics
   * @returns Unsubscribe function
   */
  subscribeToDiagnostics(listener: (diag: VADDiagnostics) => void): () => void {
    this.diagnosticsListeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.diagnosticsListeners.indexOf(listener);
      if (index > -1) {
        this.diagnosticsListeners.splice(index, 1);
      }
    };
  }
  
  /**
   * Get current diagnostics snapshot
   */
  getDiagnostics(): VADDiagnostics {
    return {
      isListening: this.isListening,
      isSpeaking: this.isSpeaking,
      currentEnergy: this.currentEnergy,
      threshold: this.config.adaptiveThreshold ? this.adaptiveThreshold : this.config.energyThreshold,
      phraseDuration: this.isSpeaking ? Date.now() - this.phraseStartTime : 0,
      chunkCount: this.recordingCounter,
      lastMeteringValue: this.lastMeteringValue,
      meteringCallbackCount: this.meteringCallbackCount,
    };
  }

  /**
   * Stop continuous recording
   */
  async stop(): Promise<void> {
    console.log('[ContinuousRecording] Stopping continuous mode');
    
    this.isListening = false;
    this.onPhraseDetected = null;

    // Stop watchdog
    this.stopCallbackWatchdog();

    // Clear silence timer
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    // Reset energy tracking
    this.energySamples = [];
    this.maxEnergyDetected = 0;
    this.recentEnergyLevels = [];

    // Stop recording
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
      } catch (error) {
        console.error('[ContinuousRecording] Error stopping recording:', error);
      }
      this.recording = null;
    }

    // Reset audio mode
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (error) {
      console.error('[ContinuousRecording] Error resetting audio mode:', error);
    }

    this.isSpeaking = false;
    this.isTTSPlaying = false;
    
    // Clear diagnostics listeners
    this.diagnosticsListeners = [];
    
    console.log('[ContinuousRecording] Stopped');
  }
}

