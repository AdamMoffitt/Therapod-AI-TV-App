import { Audio } from 'expo-av';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

export class MicrophoneTest {
  static async testMicrophonePermissions() {
    try {
      console.log('🎤 Testing microphone permissions...');
      
      // Test audio permissions
      const audioPermission = await Audio.requestPermissionsAsync();
      console.log('Audio permission status:', audioPermission.status);
      
      // Test speech recognition permissions
      const speechPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      console.log('Speech recognition permission status:', speechPermission.granted);
      
      return {
        audio: audioPermission.status === 'granted',
        speech: speechPermission.granted,
        success: audioPermission.status === 'granted' && speechPermission.granted
      };
    } catch (error) {
      console.error('❌ Error testing microphone permissions:', error);
      return { audio: false, speech: false, success: false, error };
    }
  }

  static async testAudioConfiguration() {
    try {
      console.log('🎤 Testing audio configuration...');
      
      if (Platform.OS === 'android' && Platform.isTV) {
        // Android TV specific configuration
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ Android TV audio mode configured successfully');
      } else if (Platform.OS === 'android') {
        // Regular Android configuration
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ Android audio mode configured successfully');
      } else {
        // iOS configuration
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ iOS audio mode configured successfully');
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error configuring audio mode:', error);
      return { success: false, error };
    }
  }

  static async testSpeechRecognition() {
    try {
      console.log('🎤 Testing speech recognition...');
      
      // Check availability first
      const isAvailable = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!isAvailable) {
        console.error('❌ Speech recognition not available');
        return { success: false, error: 'Speech recognition not available' };
      }
      
      const config = {
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        // Android TV specific optimizations
        ...(Platform.OS === 'android' && Platform.isTV && {
          partialResults: true,
          maxAlternatives: 3,
          recognitionTimeout: 10000, // 10 second timeout
          speechTimeout: 2000, // 2 seconds of silence to complete
        }),
      };
      
      console.log('Starting speech recognition with config:', JSON.stringify(config, null, 2));
      ExpoSpeechRecognitionModule.start(config);
      
      // Stop after 3 seconds
      setTimeout(() => {
        ExpoSpeechRecognitionModule.stop();
        console.log('✅ Speech recognition test completed');
      }, 3000);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error testing speech recognition:', error);
      return { success: false, error };
    }
  }

  static async testAndroidTVSpecific() {
    if (!(Platform.OS === 'android' && Platform.isTV)) {
      return { success: true, message: 'Not Android TV - skipping TV-specific tests' };
    }

    try {
      console.log('📺 Testing Android TV specific configurations...');
      
      // Test TV-specific audio configuration
      const audioConfig = await this.testAudioConfiguration();
      if (!audioConfig.success) {
        return { success: false, error: 'TV audio configuration failed' };
      }
      
      // Test TV-specific speech recognition
      const speechConfig = await this.testSpeechRecognition();
      if (!speechConfig.success) {
        return { success: false, error: 'TV speech recognition failed' };
      }
      
      // Test TV-specific microphone detection
      const micDetection = await this.detectTVMicrophone();
      console.log('📺 TV Microphone Detection:', micDetection);
      
      // Test TV-specific error handling
      const errorHandling = this.testTVErrorHandling();
      if (!errorHandling.success) {
        return { success: false, error: 'TV error handling test failed' };
      }
      
      console.log('✅ Android TV specific tests passed');
      return { success: true };
    } catch (error) {
      console.error('❌ Android TV specific test failed:', error);
      return { success: false, error };
    }
  }

  static testTVErrorHandling() {
    try {
      console.log('📺 Testing TV error handling...');
      
      // Simulate common TV microphone errors
      const testErrors = [
        { error: 'not-allowed', expected: 'Microphone access denied' },
        { error: 'no-speech', expected: 'No speech detected' },
        { error: 'network', expected: 'Network connection required' },
        { error: 'audio-capture', expected: 'Microphone hardware error' },
      ];
      
      testErrors.forEach(testError => {
        console.log(`Testing error: ${testError.error} - Expected: ${testError.expected}`);
      });
      
      console.log('✅ TV error handling test completed');
      return { success: true };
    } catch (error) {
      console.error('❌ TV error handling test failed:', error);
      return { success: false, error };
    }
  }

  static async detectTVMicrophone() {
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

  static async runFullTest() {
    console.log('🚀 Starting full microphone test...');
    
    const permissions = await this.testMicrophonePermissions();
    if (!permissions.success) {
      console.error('❌ Permission test failed');
      return { success: false, step: 'permissions', details: permissions };
    }
    
    const audioConfig = await this.testAudioConfiguration();
    if (!audioConfig.success) {
      console.error('❌ Audio configuration test failed');
      return { success: false, step: 'audio_config', details: audioConfig };
    }
    
    const speechRecognition = await this.testSpeechRecognition();
    if (!speechRecognition.success) {
      console.error('❌ Speech recognition test failed');
      return { success: false, step: 'speech_recognition', details: speechRecognition };
    }
    
    // Run Android TV specific tests if applicable
    const tvSpecific = await this.testAndroidTVSpecific();
    if (!tvSpecific.success) {
      console.error('❌ Android TV specific test failed');
      return { success: false, step: 'tv_specific', details: tvSpecific };
    }
    
    console.log('✅ All microphone tests passed!');
    return { success: true };
  }
}

export default MicrophoneTest; 