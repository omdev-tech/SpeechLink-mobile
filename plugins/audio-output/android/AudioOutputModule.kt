package com.naqued.speechlinkmobile

import android.content.Context
import android.media.AudioManager
import android.media.AudioFocusRequest
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableNativeMap
import java.io.File

class AudioOutputModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val TAG = "AudioOutputModule"
  
  // Get the Android AudioManager
  private val audioManager: AudioManager
    get() = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  
  // MediaPlayer for native audio playback
  private var mediaPlayer: MediaPlayer? = null

  override fun getName(): String {
    return "AudioOutput"
  }

  @ReactMethod
  fun forceSpeaker(promise: Promise) {
    try {
      Log.d(TAG, "=== FORCING LOUDSPEAKER OUTPUT (OVERRIDE BLUETOOTH) ===")
      
      // Request audio focus for media playback with speaker routing
      requestAudioFocusForSpeaker()
      
      // AGGRESSIVE APPROACH: Disable Bluetooth audio FIRST before enabling speaker
      if (audioManager.isBluetoothScoOn) {
        audioManager.stopBluetoothSco()
        audioManager.isBluetoothScoOn = false
        Log.d(TAG, "Stopped Bluetooth SCO (voice)")
      }
      
      // Apply speaker routing
      applySpeakerRouting()
      
      Log.d(TAG, "✅ Speaker routing applied - MODE: ${audioManager.mode}, Speaker: ${audioManager.isSpeakerphoneOn}")
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "❌ Failed to force speaker: ${e.message}", e)
      promise.resolve(false)
    }
  }
  
  private fun requestAudioFocusForSpeaker() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        
        val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(audioAttributes)
          .setAcceptsDelayedFocusGain(false)
          .setWillPauseWhenDucked(false)
          .build()
        
        audioManager.requestAudioFocus(focusRequest)
        Log.d(TAG, "Audio focus requested for speaker")
      } else {
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(
          null,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
        )
        Log.d(TAG, "Audio focus requested (legacy)")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to request audio focus: ${e.message}")
    }
  }
  
  private fun applySpeakerRouting() {
    // CRITICAL: Must use MODE_IN_COMMUNICATION for isSpeakerphoneOn to work!
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    audioManager.isSpeakerphoneOn = true
    
    // Boost volumes
    val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
    audioManager.setStreamVolume(AudioManager.STREAM_VOICE_CALL, maxVolume, 0)
    
    val maxMediaVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, maxMediaVolume, 0)
    
    Log.d(TAG, "Speaker routing applied - Mode: ${audioManager.mode}, Speaker: ${audioManager.isSpeakerphoneOn}")
  }
  
  @ReactMethod
  fun disableForceSpeaker(promise: Promise) {
    try {
      Log.d(TAG, "Disabling forced speaker...")
      
      // Turn off speakerphone
      audioManager.isSpeakerphoneOn = false
      
      // Return to normal audio mode
      audioManager.mode = AudioManager.MODE_NORMAL
      
      Log.d(TAG, "Speaker force disabled - Mode: ${audioManager.mode}, Speakerphone: ${audioManager.isSpeakerphoneOn}")
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to disable speaker force: ${e.message}", e)
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun forceEarpiece(promise: Promise) {
    try {
      Log.d(TAG, "Forcing earpiece output...")
      
      // Use MODE_IN_COMMUNICATION for earpiece (this is appropriate for earpiece mode)
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      
      // Turn OFF speakerphone (routes to earpiece)
      audioManager.isSpeakerphoneOn = false
      
      // Stop Bluetooth SCO if it's active
      if (audioManager.isBluetoothScoOn) {
        audioManager.stopBluetoothSco()
        audioManager.isBluetoothScoOn = false
      }
      
      Log.d(TAG, "Earpiece forced successfully")
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to force earpiece: ${e.message}", e)
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun allowNormalRouting(promise: Promise) {
    try {
      Log.d(TAG, "=== ALLOWING NORMAL AUDIO ROUTING ===")
      
      // SIMPLE APPROACH: Use MODE_NORMAL + speakerphone OFF
      // Let Android automatically route to Bluetooth/wired/earpiece
      audioManager.mode = AudioManager.MODE_NORMAL
      audioManager.isSpeakerphoneOn = false
      
      Log.d(TAG, "✅ Normal routing enabled - Mode: NORMAL, Speakerphone: OFF")
      Log.d(TAG, "Android will route to: Bluetooth > Wired > Default")
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "❌ Failed to enable normal routing: ${e.message}", e)
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getAudioRoutingInfo(promise: Promise) {
    try {
      val info = WritableNativeMap()
      info.putInt("mode", audioManager.mode)
      info.putBoolean("isSpeakerphoneOn", audioManager.isSpeakerphoneOn)
      info.putBoolean("isBluetoothScoOn", audioManager.isBluetoothScoOn)
      info.putBoolean("isBluetoothA2dpOn", audioManager.isBluetoothA2dpOn)
      info.putBoolean("isMusicActive", audioManager.isMusicActive)
      
      Log.d(TAG, "Audio routing info: mode=${audioManager.mode}, speakerphone=${audioManager.isSpeakerphoneOn}")
      promise.resolve(info)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to get audio info: ${e.message}", e)
      promise.resolve(WritableNativeMap())
    }
  }
  
  @ReactMethod
  fun playAudio(filePath: String, promise: Promise) {
    try {
      Log.d(TAG, "=== PLAYING AUDIO VIA NATIVE MODULE ===")
      Log.d(TAG, "File path: $filePath")
      
      // Stop any currently playing audio
      stopAudio()
      
      // Create new MediaPlayer
      mediaPlayer = MediaPlayer().apply {
        // CRITICAL: Use USAGE_VOICE_COMMUNICATION to respect isSpeakerphoneOn setting
        // USAGE_MEDIA would route to Bluetooth automatically, ignoring our speaker setting!
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        
        // Set data source (support both file:// URIs and absolute paths)
        val path = if (filePath.startsWith("file://")) {
          filePath.substring(7)
        } else {
          filePath
        }
        
        setDataSource(path)
        prepare()
        
        // Set completion listener
        setOnCompletionListener {
          Log.d(TAG, "✅ Audio playback completed")
          stopAudio()
        }
        
        // Set error listener
        setOnErrorListener { _, what, extra ->
          Log.e(TAG, "❌ MediaPlayer error: what=$what, extra=$extra")
          stopAudio()
          false
        }
        
        // Start playback
        start()
        Log.d(TAG, "✅ Native audio playback started - duration: ${duration}ms")
        Log.d(TAG, "Current audio mode: ${audioManager.mode}, Speaker: ${audioManager.isSpeakerphoneOn}")
      }
      
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "❌ Failed to play audio: ${e.message}", e)
      stopAudio()
      promise.reject("PLAYBACK_ERROR", e.message, e)
    }
  }
  
  @ReactMethod
  fun stopAudio(promise: Promise? = null) {
    try {
      mediaPlayer?.let {
        if (it.isPlaying) {
          it.stop()
          Log.d(TAG, "Audio playback stopped")
        }
        it.release()
        mediaPlayer = null
      }
      promise?.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to stop audio: ${e.message}", e)
      promise?.reject("STOP_ERROR", e.message, e)
    }
  }
}

