import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

class AudioService {
  private isInitialized = false;
  private isListening = false;
  private retryTimeout: any = null;
  private maxRetries = 5;
  private retryCount = 0;

  async initialize() {
    if (this.isInitialized) return;
    
    try {
      console.log('🎤 Initializing Audio Service...');
      
      // Request all necessary permissions
      await this.requestPermissions();
      
      // Configure audio mode for continuous listening
      await this.configureAudioMode();
      
      // For TV apps, we don't need background monitoring since app stays in foreground
      
      this.isInitialized = true;
      console.log('✅ Audio Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Audio Service:', error);
      throw error;
    }
  }

  private async requestPermissions() {
    try {
      // Request microphone permission
      const audioPermission = await Audio.requestPermissionsAsync();
      if (audioPermission.status !== 'granted') {
        throw new Error('Microphone permission denied');
      }
      
      // Request speech recognition permission
      const speechPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!speechPermission.granted) {
        throw new Error('Speech recognition permission denied');
      }
      
      console.log('✅ All audio permissions granted');
    } catch (error) {
      console.error('❌ Permission request failed:', error);
      throw error;
    }
  }

  private async configureAudioMode() {
    try {
      // Simplified audio configuration that works reliably
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      console.log('✅ Audio mode configured for continuous listening');
    } catch (error) {
      console.error('❌ Failed to configure audio mode:', error);
      throw error;
    }
  }



  async startContinuousListening(config: any = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log('🎤 Starting continuous listening...');
      
      const defaultConfig = {
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        // Android-specific optimizations
        ...(Platform.OS === 'android' && {
          partialResults: true,
          maxAlternatives: 3,
        }),
        ...config
      };

      // Clear any existing retry timeout
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
      }

      ExpoSpeechRecognitionModule.start(defaultConfig);
      this.isListening = true;
      this.retryCount = 0;
      
      console.log('✅ Continuous listening started with config:', JSON.stringify(defaultConfig, null, 2));
    } catch (error) {
      console.error('❌ Failed to start continuous listening:', error);
      this.handleListeningError(error);
    }
  }

  async stopListening() {
    try {
      console.log('🛑 Stopping continuous listening...');
      
      ExpoSpeechRecognitionModule.stop();
      this.isListening = false;
      
      // Clear retry timeout
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
      }
      
      console.log('✅ Continuous listening stopped');
    } catch (error) {
      console.error('❌ Error stopping listening:', error);
    }
  }

  private handleListeningError(error: any) {
    console.error('🎤 Listening error occurred:', error);
    
    // Handle "no-speech" error specifically - this is normal and should restart immediately
    if (error.message && error.message.includes('no-speech')) {
      console.log('🔄 No speech detected - restarting immediately for continuous listening...');
      this.retryTimeout = setTimeout(() => {
        if (this.isListening) {
          this.startContinuousListening();
        }
      }, 100); // Very short delay for no-speech errors
      return;
    }
    
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(`🔄 Retrying listening (${this.retryCount}/${this.maxRetries})...`);
      
      this.retryTimeout = setTimeout(() => {
        this.startContinuousListening();
      }, 1000 * this.retryCount); // Exponential backoff for other errors
    } else {
      console.error('❌ Max retries reached, stopping listening attempts');
      this.isListening = false;
    }
  }



  private isCurrentlyListening(): boolean {
    // This would need to be implemented based on the actual speech recognition state
    // For now, we'll use the internal flag
    return this.isListening;
  }

  // Method to ensure microphone stays active
  async ensureMicrophoneActive() {
    if (!this.isListening) {
      console.log('🎤 Microphone inactive - restarting...');
      await this.startContinuousListening();
    }
  }

  // Method to handle speech recognition end events
  onSpeechRecognitionEnd() {
    console.log('🔄 Speech recognition ended - restarting for continuous listening...');
    // Restart immediately for continuous listening
    setTimeout(() => {
      if (this.isListening) {
        this.startContinuousListening();
      }
    }, 50); // Very short delay
  }

  async cleanup() {
    try {
      console.log('🧹 Cleaning up Audio Service...');
      
      // Stop listening
      if (this.isListening) {
        await this.stopListening();
      }
      

      
      // Clear any timeouts
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
      }
      
      this.isInitialized = false;
      console.log('✅ Audio Service cleaned up');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  // Public getters
  get isListeningActive() {
    return this.isListening;
  }

  get isServiceInitialized() {
    return this.isInitialized;
  }
}

// Export singleton instance
export const audioService = new AudioService();
export default audioService; 