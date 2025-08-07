import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

interface MicrophoneTestComponentProps {
  onClose: () => void;
}

export default function MicrophoneTestComponent({ onClose }: MicrophoneTestComponentProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [testResults, setTestResults] = useState<string[]>([]);
  const [echoTestMode, setEchoTestMode] = useState(false);

  // Add test result
  const addTestResult = (result: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${result}`]);
  };

  // Test audio configuration
  const testAudioConfiguration = async () => {
    try {
      addTestResult('Testing audio configuration...');
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
      });
      
      addTestResult('✅ Audio configuration successful');
      return true;
    } catch (error) {
      addTestResult(`❌ Audio configuration failed: ${error}`);
      return false;
    }
  };

  // Test permissions
  const testPermissions = async () => {
    try {
      addTestResult('Testing permissions...');
      
      const audioPermission = await Audio.requestPermissionsAsync();
      const speechPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      
      if (audioPermission.status === 'granted' && speechPermission.granted) {
        addTestResult('✅ All permissions granted');
        return true;
      } else {
        addTestResult(`❌ Permissions failed - Audio: ${audioPermission.status}, Speech: ${speechPermission.granted}`);
        return false;
      }
    } catch (error) {
      addTestResult(`❌ Permission test failed: ${error}`);
      return false;
    }
  };

  // Start recording test
  const startRecordingTest = async () => {
    try {
      addTestResult('Starting recording test...');
      
      const config = {
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
      };
      
      ExpoSpeechRecognitionModule.start(config);
      setIsRecording(true);
      addTestResult('✅ Recording started');
    } catch (error) {
      addTestResult(`❌ Recording failed: ${error}`);
    }
  };

  // Stop recording test
  const stopRecordingTest = async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
      setIsRecording(false);
      addTestResult('🛑 Recording stopped');
    } catch (error) {
      addTestResult(`❌ Stop recording failed: ${error}`);
    }
  };

  // Echo test
  const startEchoTest = async () => {
    setEchoTestMode(true);
    addTestResult('🎵 Starting echo test - speak after 3 seconds...');
    
    // Play a test tone
    setTimeout(() => {
      addTestResult('🔊 Playing test tone - check if microphone picks it up');
      // In a real implementation, you would play a test tone here
    }, 3000);
  };

  // Speech recognition event handlers
  useSpeechRecognitionEvent("start", () => {
    addTestResult('🎤 Speech recognition started');
  });

  useSpeechRecognitionEvent("end", () => {
    addTestResult('🛑 Speech recognition ended');
    setIsRecording(false);
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (event.results && event.results.length > 0) {
      const result = event.results[0];
      const transcribedText = result.transcript;
      const confidence = result.confidence;
      
      setRecognizedText(transcribedText);
      
      if (echoTestMode) {
        addTestResult(`🚫 ECHO DETECTED: "${transcribedText}" (confidence: ${confidence})`);
        setEchoTestMode(false);
      } else {
        addTestResult(`✅ Speech detected: "${transcribedText}" (confidence: ${confidence})`);
      }
    }
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (event.value !== undefined) {
      setAudioLevel(event.value);
      if (event.value > 0.1) {
        addTestResult(`🎚️ Audio level: ${(event.value * 100).toFixed(1)}%`);
      }
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    addTestResult(`❌ Speech recognition error: ${event.error}`);
    setIsRecording(false);
  });

  // Run full test
  const runFullTest = async () => {
    setTestResults([]);
    addTestResult('🚀 Starting full microphone test...');
    
    const permissionsOk = await testPermissions();
    if (!permissionsOk) return;
    
    const audioConfigOk = await testAudioConfiguration();
    if (!audioConfigOk) return;
    
    addTestResult('✅ Basic tests passed - ready for recording test');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Microphone Test</Text>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.controls}>
          <TouchableOpacity style={styles.testButton} onPress={runFullTest}>
            <Text style={styles.buttonText}>Run Full Test</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.testButton, isRecording && styles.recordingButton]} 
            onPress={isRecording ? stopRecordingTest : startRecordingTest}
          >
            <Text style={styles.buttonText}>
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.testButton} onPress={startEchoTest}>
            <Text style={styles.buttonText}>Echo Test</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            Status: {isRecording ? '🎤 Recording' : '⏸️ Stopped'}
          </Text>
          <Text style={styles.statusText}>
            Audio Level: {(audioLevel * 100).toFixed(1)}%
          </Text>
          {recognizedText ? (
            <Text style={styles.recognizedText}>
              Last: "{recognizedText}"
            </Text>
          ) : null}
        </View>

        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>Test Results:</Text>
          {testResults.map((result, index) => (
            <Text key={index} style={styles.resultText}>
              {result}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#A67B5B',
  },
  closeButton: {
    padding: 10,
  },
  closeButtonText: {
    fontSize: 20,
    color: '#A67B5B',
  },
  content: {
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  testButton: {
    backgroundColor: '#A67B5B',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 120,
    alignItems: 'center',
  },
  recordingButton: {
    backgroundColor: '#8BC34A',
  },
  buttonText: {
    color: '#FFF8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  statusContainer: {
    backgroundColor: '#F5DEB3',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  statusText: {
    fontSize: 16,
    color: '#5C4033',
    marginBottom: 5,
  },
  recognizedText: {
    fontSize: 14,
    color: '#5C4033',
    fontStyle: 'italic',
  },
  resultsContainer: {
    flex: 1,
    backgroundColor: '#F5DEB3',
    padding: 15,
    borderRadius: 10,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#5C4033',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 12,
    color: '#5C4033',
    marginBottom: 2,
  },
}); 