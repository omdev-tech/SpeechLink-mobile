import { useState, useCallback } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { sttService, TranscriptionResult } from '../services/sttService';

export interface UseSpeechToTextResult {
  isRecording: boolean;
  transcription: string | null;
  confidence: number | null;
  isTranscribing: boolean;
  isEnhancing: boolean;
  enhancedText: string | null;
  recordingUri: string | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | undefined>;
  transcribeRecording: (
    provider?: 'AUTO' | 'DEEPGRAM' | 'WHISPER' | 'SPEECHMATIC' | 'ELEVENLABS',
    language?: string
  ) => Promise<TranscriptionResult>;
  enhanceTranscription: (text: string) => Promise<string>;
  resetState: () => void;
}

export const useSpeechToText = (): UseSpeechToTextResult => {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [enhancedText, setEnhancedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    try {
      // Reset states
      setError(null);
      setTranscription(null);
      setConfidence(null);
      setEnhancedText(null);
      
      // Request permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission to access microphone was denied');
        return;
      }

      // Prepare recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Start recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      console.error('Error starting recording:', err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      if (!recording) {
        return;
      }

      // Stop recording
      await recording.stopAndUnloadAsync();
      setIsRecording(false);
      
      // Get recording URI
      const uri = recording.getURI();
      if (!uri) {
        throw new Error('Recording URI is null');
      }
      
      setRecordingUri(uri);
      setRecording(null);
      
      // Reset recording mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
      
      return uri;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
      console.error('Error stopping recording:', err);
    }
  }, [recording]);

  const transcribeRecording = useCallback(async (
    provider: 'AUTO' | 'DEEPGRAM' | 'WHISPER' | 'SPEECHMATIC' | 'ELEVENLABS' = 'AUTO',
    language: string = 'en'
  ): Promise<TranscriptionResult> => {
    try {
      setIsTranscribing(true);
      setError(null);
      
      if (!recordingUri) {
        throw new Error('No recording available to transcribe');
      }
      
      const result = await sttService.transcribeAudio(recordingUri, provider, language);
      
      setTranscription(result.text);
      setConfidence(result.confidence || null);
      
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transcribe audio');
      console.error('Error transcribing audio:', err);
      throw err;
    } finally {
      setIsTranscribing(false);
    }
  }, [recordingUri]);

  const enhanceTranscription = useCallback(async (text: string): Promise<string> => {
    try {
      setIsEnhancing(true);
      setError(null);
      
      const enhanced = await sttService.enhanceTranscription(text);
      setEnhancedText(enhanced);
      
      return enhanced;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enhance transcription');
      console.error('Error enhancing transcription:', err);
      throw err;
    } finally {
      setIsEnhancing(false);
    }
  }, []);

  const resetState = useCallback(() => {
    if (recording) {
      recording.stopAndUnloadAsync().catch(console.error);
    }
    
    setRecording(null);
    setIsRecording(false);
    setRecordingUri(null);
    setTranscription(null);
    setConfidence(null);
    setIsTranscribing(false);
    setIsEnhancing(false);
    setEnhancedText(null);
    setError(null);
  }, [recording]);

  return {
    isRecording,
    transcription,
    confidence,
    isTranscribing,
    isEnhancing,
    enhancedText,
    recordingUri,
    error,
    startRecording,
    stopRecording,
    transcribeRecording,
    enhanceTranscription,
    resetState
  };
}; 