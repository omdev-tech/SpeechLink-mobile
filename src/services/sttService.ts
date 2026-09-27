import { apiService } from './apiService';
import * as FileSystem from 'expo-file-system/legacy';

export interface STTRequest {
  audio: string; // Base64 encoded audio
  provider?: 'AUTO' | 'DEEPGRAM' | 'WHISPER' | 'SPEECHMATIC' | 'ELEVENLABS';
  language?: string;
  options?: {
    [key: string]: any;
  };
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  provider?: string;
  duration?: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence?: number;
  }>;
}

class STTService {
  private static instance: STTService;

  private constructor() {}

  public static getInstance(): STTService {
    if (!STTService.instance) {
      STTService.instance = new STTService();
    }
    return STTService.instance;
  }

  public async transcribeAudio(
    audioUri: string,
    provider: 'AUTO' | 'DEEPGRAM' | 'WHISPER' | 'SPEECHMATIC' | 'ELEVENLABS' = 'AUTO',
    language: string = 'en'
  ): Promise<TranscriptionResult> {
    try {
      // Read the audio file as base64
      const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Create form data for the request
      const formData = new FormData();
      
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      const fileNameParts = audioUri.split('/');
      const fileName = fileNameParts[fileNameParts.length - 1];
      
      // Append the audio file
      formData.append('audio', {
        uri: audioUri,
        type: 'audio/mp3', // Adjust based on your file format
        name: fileName || 'recording.mp3',
      } as any);
      
      // Append additional parameters
      formData.append('provider', provider);
      formData.append('language', language);

      // Send to backend using apiService
      const response = await apiService.fetchWithAuth('/stt', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Parse the response
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error in speech-to-text:', error);
      throw error;
    }
  }

  public async enhanceTranscription(text: string): Promise<string> {
    try {
      // Call the enhancement endpoint
      const response = await apiService.post<{ enhancedText: string }>('/enhance', {
        text,
      });
      
      return response.enhancedText || text;
    } catch (error) {
      console.error('Error enhancing transcription:', error);
      // Return original text if enhancement fails
      return text;
    }
  }
}

export const sttService = STTService.getInstance(); 