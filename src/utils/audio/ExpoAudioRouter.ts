import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// Import our module using the expo-modules API pattern
import { AudioRouter } from './ExpoModules';

export class ExpoAudioRouter {
  private isRouting = false;

  constructor() {
    // Log module availability
    console.log('ExpoAudioRouter initialized, checking module availability');
    this.isModuleAvailable().then(available => {
      console.log('AudioRouter module available:', available);
    });
  }

  async isModuleAvailable(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }
    
    try {
      // Try a simple operation to test module availability
      // We use a try/catch since Expo modules will throw if not available
      return !!AudioRouter;
    } catch (error) {
      console.error('Error checking AudioRouter availability:', error);
      return false;
    }
  }

  async routeAudioToMicrophone(audioData: ArrayBuffer): Promise<boolean> {
    try {
      if (Platform.OS !== 'android') {
        throw new Error('This module only works on Android');
      }

      if (!AudioRouter) {
        console.error('Cannot route audio: AudioRouter module is not available');
        return false;
      }

      // Convert ArrayBuffer to base64 string
      const base64Data = this.arrayBufferToBase64(audioData);

      // Save audio data to a file
      const filePath = `${FileSystem.cacheDirectory}tts_output_for_mic.mp3`;
      await FileSystem.writeAsStringAsync(filePath, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log('Calling Expo AudioRouter.routeAudioToMicrophone with file path:', filePath);
      
      // Call native module to route audio
      const result = await AudioRouter.routeAudioToMicrophone(filePath);
      this.isRouting = result;
      return result;
    } catch (error) {
      console.error('Failed to route audio to microphone:', error);
      
      // Always provide a mock success response for development
      if (__DEV__) {
        console.log('[DEV MODE] Returning mock success response');
        return true;
      }
      return false;
    }
  }

  async stopAudioRouting(): Promise<void> {
    if (this.isRouting) {
      try {
        if (AudioRouter) {
          console.log('Stopping audio routing with Expo AudioRouter');
          await AudioRouter.stopAudioRouting();
        } else {
          console.log('[MOCK] stopAudioRouting called');
        }
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