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
      
      if (Platform.OS === 'android') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
          interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
        });
        console.log('✅ Android audio mode configured successfully');
      } else {
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
    
    console.log('✅ All microphone tests passed!');
    return { success: true };
  }
}

export default MicrophoneTest; 