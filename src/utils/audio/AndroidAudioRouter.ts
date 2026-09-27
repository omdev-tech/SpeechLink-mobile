import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModuleChecker } from './NativeModuleChecker';

// Define interface for our native module
interface AudioRouterModule {
  routeAudioToMicrophone(audioFilePath: string): Promise<boolean>;
  stopAudioRouting(): Promise<void>;
}

// Enhanced error handling for native module
const getAudioRouterModule = () => {
  const { AudioRouterModule } = NativeModules;
  
  // Check if module is available using our utility
  const isAvailable = NativeModuleChecker.isAudioRouterModuleAvailable();
  
  if (!isAvailable) {
    console.warn('AudioRouterModule is not available. Using mock implementation instead.');
    // Provide a mock implementation for development
    return {
      routeAudioToMicrophone: async (filePath: string): Promise<boolean> => {
        console.log('[MOCK] routeAudioToMicrophone called with:', filePath);
        return true;
      },
      stopAudioRouting: async (): Promise<void> => {
        console.log('[MOCK] stopAudioRouting called');
      }
    };
  }
  
  return AudioRouterModule;
};

export class AndroidAudioRouter {
  private isRouting = false;
  private AudioRouterModule: AudioRouterModule | null = null;

  // Static method to check module availability
  static isModuleAvailable(): boolean {
    return NativeModuleChecker.isAudioRouterModuleAvailable();
  }

  constructor() {
    // Verify the module exists
    this.AudioRouterModule = getAudioRouterModule();
    
    if (this.AudioRouterModule) {
      console.log('AudioRouter initialized successfully');
    }
  }

  async routeAudioToMicrophone(audioData: ArrayBuffer): Promise<boolean> {
    try {
      if (Platform.OS !== 'android') {
        throw new Error('This module only works on Android');
      }

      if (!this.AudioRouterModule) {
        console.error('Cannot route audio: AudioRouterModule is not available');
        return false;
      }

      // Convert ArrayBuffer to base64 string
      const base64Data = this.arrayBufferToBase64(audioData);

      // Save audio data to a file
      const filePath = `${FileSystem.cacheDirectory}tts_output_for_mic.mp3`;
      await FileSystem.writeAsStringAsync(filePath, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log('Calling routeAudioToMicrophone with file path:', filePath);
      
      // Call native module to route audio
      const result = await this.AudioRouterModule.routeAudioToMicrophone(filePath);
      this.isRouting = result;
      return result;
    } catch (error) {
      console.error('Failed to route audio to microphone:', error);
      return false;
    }
  }

  async stopAudioRouting(): Promise<void> {
    if (this.isRouting && this.AudioRouterModule) {
      try {
        await this.AudioRouterModule.stopAudioRouting();
        this.isRouting = false;
      } catch (error) {
        console.error('Error stopping audio routing:', error);
      }
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
} 