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
      // Android TV specific configuration
      if (Platform.OS === 'android' && Platform.isTV) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ Android TV audio mode configured for continuous listening');
      } else if (Platform.OS === 'android') {
        // Regular Android configuration
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ Android audio mode configured for continuous listening');
      } else {
        // iOS configuration
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ iOS audio mode configured for continuous listening');
      }
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
        // Android TV specific optimizations
        ...(Platform.OS === 'android' && Platform.isTV && {
          partialResults: true,
          maxAlternatives: 3,
          // Use cloud recognition for better reliability on TV
          requiresOnDeviceRecognition: false,
          // TV-specific timeout settings
          recognitionTimeout: 10000, // 10 second timeout
          speechTimeout: 2000, // 2 seconds of silence to complete
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
    }, Platform.OS === 'android' && Platform.isTV ? 1000 : 50); // Longer delay for TV
  }

  // TV-Specific Error Handling
  handleTVMicrophoneError(error: any) {
    console.error('❌ TV Microphone Error:', error);
    
    let errorMessage = 'Voice recognition error occurred.';
    let suggestion = '';
    
    if (error.error) {
      switch (error.error) {
        case 'not-allowed':
          errorMessage = 'Microphone access denied.';
          suggestion = 'Please enable microphone permission in TV Settings > Apps > Therapod AI Wellness > Permissions';
          break;
        case 'no-speech':
          errorMessage = 'No speech detected.';
          suggestion = 'Try speaking closer to the TV or remote control microphone.';
          break;
        case 'network':
          errorMessage = 'Network connection required.';
          suggestion = 'Please check your TV\'s internet connection.';
          break;
        case 'audio-capture':
          errorMessage = 'Microphone hardware error.';
          suggestion = 'Try restarting the app or check if another app is using the microphone.';
          break;
        default:
          errorMessage = 'Voice recognition error occurred.';
          suggestion = 'Please try again or restart the app.';
      }
    }
    
    console.error(`TV Error: ${errorMessage} - ${suggestion}`);
  }

  // Enhanced Microphone Detection for TV
  async detectTVMicrophone() {
    try {
      console.log('🔍 Detecting TV microphone capabilities...');
      
      if (Platform.OS === 'android' && Platform.isTV) {
        // Check for TV-specific microphone features
        const tvMicFeatures = {
          hasBuiltInMic: true, // Assume modern Android TVs have built-in mics
          hasRemoteMic: true,  // Most TV remotes have voice search
          hasUSBMic: false,    // Would need to check USB devices
          hasBluetoothMic: false, // Would need to check Bluetooth devices
        };
        
        console.log('📺 TV Microphone Features:', tvMicFeatures);
        return tvMicFeatures;
      }
      
      return { hasBuiltInMic: true };
    } catch (error) {
      console.error('❌ Error detecting TV microphone:', error);
      return { hasBuiltInMic: false };
    }
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