import { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  Text,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  BackHandler,
} from "react-native";
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import AudioControl from '../types/AudioControl';

import { registerGlobals } from "@livekit/react-native";
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  isTrackReference,
} from "@livekit/react-native";
import { Track } from "livekit-client";

// Register WebRTC globals
registerGlobals();

const API_CONFIG = {
  apiKey: "NDNmMDRlZDRlYjI3NDVjNjk3ODU3ZDVmZGMyNjk1OGItMTc1NDE0MjEyMQ==",
  serverUrl: "https://api.heygen.com",
};

interface GuideProps {
  onSessionEnd?: () => void;
  userId?: string | null;
  therapistName?: string | null;
}

export default function Guide({ onSessionEnd, userId, therapistName }: GuideProps) {
  const [wsUrl, setWsUrl] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [sessionToken, setSessionToken] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState("");
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);
  const [loading, setLoading] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(true); // Default to voice mode
  const [recognizedText, setRecognizedText] = useState('');
  const [conversationMode, setConversationMode] = useState<'push_to_talk' | 'continuous' | 'always_on'>('always_on');
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isAlwaysListening, setIsAlwaysListening] = useState(true);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [micPausedForAvatar, setMicPausedForAvatar] = useState(false);
  const [echoPreventionEnabled, setEchoPreventionEnabled] = useState(true);
  const [avatarSpeakingStartTime, setAvatarSpeakingStartTime] = useState<number | null>(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [ignoreSpeechResults, setIgnoreSpeechResults] = useState(false);
  const [allSpeechResults, setAllSpeechResults] = useState<string[]>([]);
  
  // Ref for interim timer
  const interimTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Start audio session and auto-start HeyGen session
  useEffect(() => {
    const setupAudio = async () => {
      // Configure audio mode to prevent echo
      try {
        // Android TV specific configuration
        if (Platform.OS === 'android' && Platform.isTV) {
          // Enhanced Android TV audio configuration
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: false,
            staysActiveInBackground: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
          });
          
          console.log('✅ Android TV audio mode optimized');
        } else if (Platform.OS === 'android') {
          // Regular Android configuration
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: false,
            staysActiveInBackground: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
          });
          console.log('✅ Android audio mode configured to prevent echo');
        } else {
          // iOS configuration
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
          });
          console.log('✅ iOS audio mode configured to prevent echo');
        }
      } catch (error) {
        console.error('❌ Failed to configure audio mode:', error);
        setVoiceModeEnabled(false);
      }
    };

    setupAudio();
    
    // Auto-start the HeyGen session when component mounts
    console.log('🚀 Starting session creation...');
    createSession().catch(error => {
      console.error('❌ Session creation failed:', error);
      // Force connect as fallback
      setConnected(true);
    });
    
    // Start always-on listening after a brief delay
    setTimeout(() => {
      if (voiceModeEnabled && conversationMode === 'always_on') {
        console.log('🚀 Initial setup: Starting always-on listening...');
        startAlwaysOnListening();
      }
    }, 3000);

    // Set up periodic microphone health check for always-on mode (less frequent to reduce beeping)
    const microphoneHealthCheck = setInterval(() => {
      if (conversationMode === 'always_on' && voiceModeEnabled && !avatarSpeaking && !micPausedForAvatar && !isRecording) {
        // console.log('🔍 Health check: Ensuring microphone is active...');
        // startAlwaysOnListening();
      }
    }, Platform.OS === 'android' && Platform.isTV ? 30000 : 20000); // 30 seconds for TV, 20 for mobile
    
    // Set up avatar speaking timeout check
    const avatarSpeakingTimeoutCheck = setInterval(() => {
      if (avatarSpeaking && avatarSpeakingStartTime) {
        const speakingDuration = Date.now() - avatarSpeakingStartTime;
        const maxSpeakingTime = Platform.OS === 'android' && Platform.isTV ? 45000 : 30000; // 45 seconds for TV, 30 for mobile
        
        if (speakingDuration > maxSpeakingTime) {
          console.log('⏰ Avatar speaking timeout - resetting state');
          setAvatarSpeaking(false);
          setMicPausedForAvatar(false);
          setAvatarSpeakingStartTime(null);
          
          // Resume listening if needed
          if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording) {
            console.log('🔄 Resuming listening after timeout');
            startAlwaysOnListening();
          }
        }
      }
    }, 5000); // Check every 5 seconds
    
    return () => {
      // Clean up audio session
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
      });
      clearInterval(microphoneHealthCheck);
      clearInterval(avatarSpeakingTimeoutCheck);
      
      // Clean up interim timer
      if (interimTimerRef.current) {
        clearTimeout(interimTimerRef.current);
      }
    };
  }, []);

  // TV Remote Control Integration
  useEffect(() => {
    if (Platform.OS === 'android' && Platform.isTV) {
      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (isRecording) {
            stopRecording();
            return true; // Prevent default back action
          }
          return false;
        }
      );

      return () => backHandler.remove();
    }
  }, [isRecording]);

  // TV Performance Optimization
  useEffect(() => {
    if (Platform.OS === 'android' && Platform.isTV) {
      // Optimize for TV performance
      const tvOptimizations = {
        // Reduce speech recognition restarts to preserve resources
        microphoneHealthCheckInterval: 15000, // 15 seconds instead of 10
        avatarSpeakingTimeout: 45000, // 45 seconds instead of 30
        errorRecoveryDelay: 1000, // 1 second instead of 500ms
      };
      
      console.log('📺 Applied TV performance optimizations:', tvOptimizations);
    }
  }, []);

  // Speech recognition event handlers
  useSpeechRecognitionEvent("start", () => {
    console.log('🎤 SPEECH RECOGNITION STARTED');
    console.log(`📊 Mode: ${conversationMode}, Voice Enabled: ${voiceModeEnabled}`);
    setIsRecording(true);
    setIsListening(true);
  });

  useSpeechRecognitionEvent("audiostart", () => {
    console.log('🎙️ AUDIO CAPTURE STARTED');
  });

  useSpeechRecognitionEvent("audioend", () => {
    console.log('🎙️ AUDIO CAPTURE ENDED');
  });

  useSpeechRecognitionEvent("end", () => {
    console.log('🛑 SPEECH RECOGNITION ENDED');
    console.log(`📊 Mode: ${conversationMode}, Always Listening: ${isAlwaysListening}`);
    // setIsRecording(false);
    // setIsListening(false);
    
    // CRITICAL: Don't restart if avatar is speaking to prevent echo
    if (avatarSpeaking || micPausedForAvatar) {
      console.log('🚫 ECHO PREVENTION: Not restarting while avatar is speaking');
      return;
    }
    
    // Always restart for always-on mode unless avatar is speaking
    if (conversationMode === 'always_on' && isAlwaysListening && !avatarSpeaking && !micPausedForAvatar && voiceModeEnabled) {
      console.log('🔄 ALWAYS-ON: Restarting microphone...');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar && conversationMode === 'always_on') {
          console.log('🎤 ALWAYS-ON: Starting new listening session...');
          // Add a small delay to ensure state is updated
          setTimeout(() => {
            startAlwaysOnListening();
          }, 100);
        } else {
          console.log('🚫 ALWAYS-ON: Skipping restart - avatar speaking or mic paused');
        }
      }, 1000); // Longer delay to prevent rapid restart loops
    }
    // In continuous mode, restart listening after a brief pause
    else if (conversationMode === 'continuous' && voiceModeEnabled) {
      console.log('⏰ Scheduling restart in 1 second...');
      setTimeout(() => {
        console.log('🔄 Auto-restarting continuous listening...');
        startContinuousListening();
      }, 1000);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.error('❌ SPEECH RECOGNITION ERROR:');
    console.error(`   Error: ${event.error}`);
    console.error(`   Message: ${event.message}`);
    console.error(`   Mode: ${conversationMode}`);
    setIsRecording(false);
    setIsListening(false);
    setRecognizedText('');
    
    // In always-on mode, try to restart after error if avatar not speaking
    if (conversationMode === 'always_on' && isAlwaysListening && !avatarSpeaking && voiceModeEnabled) {
      console.log('⏰ ALWAYS-ON: Scheduling error recovery restart in 3 seconds...');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar && isAlwaysListening && conversationMode === 'always_on') {
          console.log('🔄 ALWAYS-ON: Attempting error recovery restart...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping error recovery - avatar is speaking');
        }
      }, 3000); // Longer delay to prevent rapid restart loops
    }
    // In continuous mode, try to restart after error
    else if (conversationMode === 'continuous' && voiceModeEnabled) {
      console.log('⏰ Scheduling error recovery restart in 2 seconds...');
      setTimeout(() => {
        console.log('🔄 Attempting error recovery restart...');
        startContinuousListening();
      }, 2000);
    }
  });

  // Handle speech recognition events
  useSpeechRecognitionEvent("result", (event) => {
    console.log('🎯 SPEECH RESULT:', event);
    if (event.results && event.results.length > 0) {
      const transcript = event.results[0].transcript;
      setRecognizedText(transcript);
      
      // Add to history if it's a final result
      if (event.isFinal) {
        console.log('FINAL RESULT:', event);
        setAllSpeechResults(prev => [...prev, transcript]);
        setRecognizedText(''); // Clear current text for next input
      }
    }
  });

  // useSpeechRecognitionEvent("result", (event) => {
  //   console.log('🗣️ SPEECH RESULT RECEIVED:');
  //   console.log(`   Results count: ${event.results?.length || 0}`);
  //   console.log(`   Is Final: ${event.isFinal}`);
    
  //   // CRITICAL: Don't process speech when avatar is speaking to prevent echo
  //   if (echoPreventionEnabled && (avatarSpeaking || micPausedForAvatar)) {
  //     console.log('🚫 ECHO PREVENTION: Ignoring speech while avatar is speaking');
  //     if (event.results && event.results.length > 0) {
  //       const result = event.results[0];
  //       const transcribedText = result.transcript;    
  //       console.log(`Is Final AI Confidence: ${result.confidence !== 0 ? 'YES' : 'NO'}`);    
  //       console.log(`AI Text: "${transcribedText}"`);
  //     }
  //     return;
  //   }
    
  //   // CRITICAL: Don't process speech results during the ignore period
  //   if (ignoreSpeechResults) {
  //     console.log('🚫 IGNORING SPEECH: Still in ignore period after restart');
  //     return;
  //   }
    
  //   if (event.results && event.results.length > 0) {
  //     const result = event.results[0];
  //     const transcribedText = result.transcript;
  //     const confidence = result.confidence;
      
  //     console.log('📝 DETECTED SPEECH:');
  //     console.log(`   Text: "${transcribedText}"`);
  //     console.log(`   Confidence: ${confidence || 'N/A'}`);
  //     console.log(`   Length: ${transcribedText.length} characters`);
  //     console.log(`   Is Final: ${event.isFinal ? 'YES' : 'NO (interim)'}`);
  //     console.log(`   Is Final Confidence: ${confidence !== 0 ? 'YES' : 'NO'}`);
      
  //     setRecognizedText(transcribedText);
      
  //     // Add ALL speech results to the display array
  //     setAllSpeechResults(prev => [...prev, transcribedText]);
      
  //     // Process both final and interim results (with delay for interim)
  //     if (event.isFinal || confidence !== 0) {
  //       // Filter out very short utterances that might be noise
  //         console.log('✅ SENDING FINAL RESULT TO HEYGEN AI');
  //         sendVoiceMessage(transcribedText);
  //         setRecognizedText(''); // Clear after sending
  //     } else {
  //       console.log('⏳ Interim result - waiting for final...');
  //     }
  //   } else {
  //     console.log('⚠️ No speech results in event');
  //   }
  // });

  // Handle speech recognition errors
  useSpeechRecognitionEvent("error", (event) => {
    console.error('❌ SPEECH RECOGNITION ERROR:', event);
    
    // Handle specific error types
    if (event.error === 'no-speech') {
      console.log('🔄 No speech detected - this is normal, will restart automatically');
      // Don't treat no-speech as an error for always-on mode
      return;
    }
    
    if (event.error === 'network') {
      console.error('🌐 Network error - check internet connection');
      Alert.alert('Network Error', 'Speech recognition requires internet connection. Please check your network.');
    }
    
    if (event.error === 'not-allowed') {
      console.error('🚫 Permission denied');
      Alert.alert('Permission Denied', 'Microphone permission is required for voice chat.');
      setVoiceModeEnabled(false);
    }
    
    // For other errors, try to restart
    if (conversationMode === 'always_on' && voiceModeEnabled) {
      console.log('🔄 Attempting to restart speech recognition after error...');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar) {
          startAlwaysOnListening();
        }
      }, 2000);
    }
  });

  // Audio level monitoring for voice activity detection and echo prevention
  useSpeechRecognitionEvent("volumechange", (event) => {
    if (event.value !== undefined) {
      // Only log significant audio level changes to avoid spam
      if (event.value > 0.1) {
        console.log(`🎚️ Audio Level: ${(event.value * 100).toFixed(1)}%`);
      }
      setAudioLevel(event.value);
      
      // Echo prevention: if audio level is high and avatar is speaking, it might be echo
      if (echoPreventionEnabled && event.value > 0.5 && avatarSpeaking) {
        console.log('🚫 ECHO DETECTION: High audio level during avatar speech - possible echo');
        // Don't process this audio
        return;
      }
      
      // TV-specific audio level handling
      if (Platform.OS === 'android' && Platform.isTV) {
        // Higher threshold for TV environment (more background noise)
        const tvAudioThreshold = 0.4; // Higher than mobile threshold
        
        if (event.value > tvAudioThreshold && !isListening && 
            conversationMode === 'always_on' && !avatarSpeaking && !micPausedForAvatar) {
          console.log('🎤 TV: High audio detected - activating microphone...');
          startAlwaysOnListening();
        }
      } else {
        // Auto-resume microphone if audio level is high but not listening (for natural conversation)
        if (event.value > 0.3 && !isListening && conversationMode === 'always_on' && !avatarSpeaking && !micPausedForAvatar) {
          console.log('🎤 High audio level detected - ensuring microphone is active...');
          startAlwaysOnListening();
        }
      }
    }
  });

  const getSessionToken = async () => {
    try {
      const response = await fetch(
        `${API_CONFIG.serverUrl}/v1/streaming.create_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": API_CONFIG.apiKey,
          },
        }
      );

      const data = await response.json();
      console.log("Session token obtained", data.data.token);
      return data.data.token;
    } catch (error) {
      console.error("Error getting session token:", error);
      throw error;
    }
  };

  const startStreamingSession = async (
    sessionId: string,
    sessionToken: string
  ) => {
    try {
      console.log("Starting streaming session with:", {
        sessionId,
        sessionToken,
      });
      const startResponse = await fetch(
        `${API_CONFIG.serverUrl}/v1/streaming.start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
          }),
        }
      );

      const startData = await startResponse.json();
      console.log("Streaming start response:", startData);

      if (startData && startData.success !== false) {
        console.log("✅ Session started successfully, setting connected to true");
        setConnected(true);
        return true;
      } else {
        console.error("❌ Session start failed:", startData);
        return false;
      }
    } catch (error) {
      console.error("Error starting streaming session:", error);
      return false;
    }
  };

  const createSession = async () => {
    try {
      setLoading(true);
      // Get new session token
      const newSessionToken = await getSessionToken();
      setSessionToken(newSessionToken);

      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newSessionToken}`,
        },
        body: JSON.stringify({
          quality: "high",
          avatar_id: "Ann_Therapist_public", // Use Ann Therapist public avatar
          participant_name: `therapy-user-${userId}-${Date.now()}`, // Unique participant to prevent conflicts
          version: "v2",
          video_encoding: "H264",
        }),
      });

      const data = await response.json();
      console.log("Streaming new response:", data);

      if (data.data && data.success !== false) {
        const newSessionId = data.data.session_id;
        // Set all session data
        setSessionId(newSessionId);
        setWsUrl(data.data.url);
        setToken(data.data.access_token);

        // Connect WebSocket
        const params = new URLSearchParams({
          session_id: newSessionId,
          session_token: newSessionToken,
          silence_response: "false",
          // opening_text: "Hello from the mobile app!",
          stt_language: "en",
        });

        const wsUrl = `wss://${
          new URL(API_CONFIG.serverUrl).hostname
        }/v1/ws/streaming.chat?${params}`;

        const ws = new WebSocket(wsUrl);
        
        // Set up WebSocket message handling to prevent echo
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('📥 WebSocket message received:', JSON.stringify(data, null, 2));
            
            // Handle avatar speaking events to prevent echo
            if (data.type === 'avatar_speaking' || data.type === 'speech_start' || data.event === 'avatar_speaking') {
              console.log('🗣️ Avatar started speaking - muting microphone');
              setAvatarSpeaking(true);
              setAvatarSpeakingStartTime(Date.now());
              muteMicrophone();
            }
            
            // Handle avatar finished speaking events
            if (data.type === 'avatar_finished' || data.type === 'speech_end' || data.event === 'avatar_finished') {
              console.log('✅ Avatar finished speaking - unmuting microphone');
              setAvatarSpeaking(false);
              setAvatarSpeakingStartTime(null);
              unmuteMicrophone();
            }
            
            // Handle task completion events
            if (data.type === 'task_completed' || data.event === 'task_completed') {
              console.log('✅ Task completed - avatar should be finished speaking');
              setAvatarSpeaking(false);
              setAvatarSpeakingStartTime(null);
              unmuteMicrophone();
            }
            
            // Handle other message types
            if (data.type === 'error' || data.event === 'error') {
              console.error('❌ WebSocket error:', data.message || data.error);
            }
            
            // Log all message types for debugging
            console.log(`📋 WebSocket message type: ${data.type || data.event || 'unknown'}`);
            
          } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
            console.error('Raw message:', event.data);
          }
        };
        
        ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
        };
        
        ws.onclose = () => {
          console.log('🔌 WebSocket connection closed');
        };
        
        setWebSocket(ws);

        // Start streaming session with the new IDs
        const streamingStarted = await startStreamingSession(newSessionId, newSessionToken);
        
        // If streaming start fails, still set connected to true as a fallback
        if (!streamingStarted) {
          console.log("⚠️ Streaming start failed, but setting connected to true as fallback");
          setConnected(true);
        }
        
        // Send initial greeting after a longer delay to ensure session is fully ready
        setTimeout(async () => {
          try {
            console.log('🎬 Session fully initialized - avatar will start speaking now...');
            setSessionInitialized(true);
            
            // Mute microphone before welcome message to prevent echo
            console.log('🔇 Muting microphone for welcome message...');
            await muteMicrophone();
            
            const greetingText = therapistName 
              ? `Hello! I'm ${therapistName}, your AI therapist. I'm here for our therapy session. How are you feeling today?`
              : `Hello! I'm your AI therapist. I'm here for our therapy session. How are you feeling today?`;
              
            const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${newSessionToken}`,
              },
              body: JSON.stringify({
                session_id: newSessionId,
                text: greetingText,
                task_type: "talk",
              }),
            });
            
            const data = await response.json();
            console.log("Initial greeting sent:", data);
            
            // Start listening after initial greeting based on mode
            if (conversationMode === 'always_on' && voiceModeEnabled) {
              // Wait for avatar to finish speaking the greeting, then start listening
              setTimeout(() => {
                console.log('🚀 ALWAYS-ON: Avatar greeting should be finished, starting listening...');
                // Unmute microphone after welcome message is finished
                // unmuteMicrophone();
                // setAvatarSpeaking(false);
                // setMicPausedForAvatar(false);
                // setIsAlwaysListening(true);
                // startAlwaysOnListening();
              }, 8000); // Increased delay to give avatar more time to speak the greeting
            } else if (conversationMode === 'continuous' && voiceModeEnabled) {
              setTimeout(() => {
                // Unmute microphone after welcome message is finished
                // unmuteMicrophone();
                startContinuousListening();
              }, 5000);
            }
          } catch (error) {
            console.error("Error sending initial greeting:", error);
            // Ensure microphone is unmuted even if there's an error
            unmuteMicrophone();
          }
        }, 5000); // Increased delay from 2s to 5s to ensure session is fully ready
      }
    } catch (error) {
      console.error("Error creating session:", error);
    } finally {
      setLoading(false);
      
      // Safety timeout: if still not connected after 30 seconds, force connect
      setTimeout(() => {
        if (!connected) {
          console.log("⚠️ Safety timeout: forcing connected to true");
          setConnected(true);
        }
      }, 30000);
    }
  };

  const sendText = async () => {
    try {

      // Send task request
      const response = await fetch(
        `${API_CONFIG.serverUrl}/v1/streaming.task`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
            text: text,
            task_type: "talk",
          }),
        }
      );

      const data = await response.json();
      console.log("Task response:", data);
      setText(""); // Clear input after sending
    } catch (error) {
      console.error("Error sending text:", error);
    } finally {
    }
  };

  // Voice recognition functions
  const startRecording = async () => {
    try {
      console.log('🎤 STARTING SPEECH RECOGNITION...');
      console.log(`📊 Current Settings:`);
      console.log(`   Mode: ${conversationMode}`);
      console.log(`   Voice Enabled: ${voiceModeEnabled}`);
      console.log(`   Already Recording: ${isRecording}`);
      
      // Request permissions first
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        console.error('❌ PERMISSIONS DENIED');
        Alert.alert('Permissions Required', 'Microphone and speech recognition permissions are needed for voice chat.');
        setVoiceModeEnabled(false);
        return;
      }
      console.log('✅ Permissions granted');
      
      // Check if speech recognition is available
      const isAvailable = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!isAvailable) {
        console.error('❌ SPEECH RECOGNITION NOT AVAILABLE');
        Alert.alert('Speech Recognition Not Available', 'Speech recognition is not available on this device.');
        setVoiceModeEnabled(false);
        return;
      }
      console.log('✅ Speech recognition available');
      
      // Clear previous recognition results
      setRecognizedText('');
      
      // Ensure speech recognition is completely stopped before starting
      try {
        // console.log('🛑 Ensuring speech recognition is stopped...');
        // ExpoSpeechRecognitionModule.stop();
        // Small delay to ensure stop is processed
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (stopError) {
        console.log('ℹ️ Speech recognition was not running');
      }
      
      // Android TV optimized speech recognition config
      const config = {
        lang: 'en-US',
        interimResults: true,
        continuous: true, // Always use continuous for always-on mode
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false, // Use cloud recognition for better reliability
        // Android TV specific optimizations
        ...(Platform.OS === 'android' && Platform.isTV && {
          partialResults: true, // Get partial results faster
          maxAlternatives: 3, // More alternatives for better accuracy
        }),
      };
      
      console.log('🔧 Speech Recognition Config:', JSON.stringify(config, null, 2));
      
      // For Android TV, add additional audio source configuration
      if (Platform.OS === 'android' && Platform.isTV) {
        // Request specific microphone permissions for TV
        const audioPermission = await Audio.requestPermissionsAsync();
        if (audioPermission.status !== 'granted') {
          Alert.alert('Microphone Permission Required', 
            'Please enable microphone access in TV settings for voice chat.');
          return;
        }
      }
      
      // Start speech recognition with expo-speech-recognition
      console.log('🚀 Starting ExpoSpeechRecognitionModule.start()...');
      ExpoSpeechRecognitionModule.start(config);
      console.log('✅ TV-optimized speech recognition started');
      
      setIsRecording(true);
      setIsListening(true);
      console.log('✅ Recording state set to true');
      
      // Ignore speech results for a brief period to avoid old audio
      setIgnoreSpeechResults(true);
      console.log('⏳ Ignoring speech results for 1 second to avoid old audio...');
      setTimeout(() => {
        setIgnoreSpeechResults(false);
        console.log('✅ Ready to process new speech results');
      }, 1000);
    } catch (error) {
      console.error('❌ Failed to start speech recognition:', error);
      handleTVMicrophoneError(error);
    }
  };

  const stopRecording = async () => {
    try {
      console.log('🛑 STOPPING SPEECH RECOGNITION...');
      console.log(`📊 Current state - Recording: ${isRecording}, Listening: ${isListening}`);
      
      // Stop speech recognition
      ExpoSpeechRecognitionModule.stop();
      console.log('✅ SPEECH RECOGNITION STOP REQUESTED');
      
      // The results will be handled in the useSpeechRecognitionEvent callbacks
    } catch (error) {
      console.error('❌ FAILED TO STOP SPEECH RECOGNITION:', error);
      setIsRecording(false);
    }
  };

  const startContinuousListening = async () => {
    console.log('🔄 CONTINUOUS LISTENING CHECK:');
    console.log(`   Mode: ${conversationMode}`);
    console.log(`   Voice Enabled: ${voiceModeEnabled}`);
    console.log(`   Recording: ${isRecording}`);
    
    if (conversationMode === 'continuous' && voiceModeEnabled) {
      console.log('✅ CONDITIONS MET - STARTING CONTINUOUS LISTENING...');
      await startRecording();
    } else {
      console.log('🚫 CONDITIONS NOT MET - SKIPPING CONTINUOUS LISTENING');
    }
  };

  const startAlwaysOnListening = async () => {
    
    // Prevent multiple simultaneous restart attempts
    if (isRestarting) {
      console.log('🚫 Already restarting - skipping duplicate request');
      return;
    }
    
    // Check each condition individually for better debugging
    const conditions = {
      conversationMode: conversationMode === 'always_on',
      voiceEnabled: voiceModeEnabled,
      notAvatarSpeaking: !avatarSpeaking,
      notMicPaused: !micPausedForAvatar,
      alwaysListening: isAlwaysListening
    };
    
    console.log('🔍 START ALWAYS-ON CONDITION CHECK:');
    console.log(`   conversationMode === 'always_on': ${conditions.conversationMode}`);
    console.log(`   voiceModeEnabled: ${conditions.voiceEnabled}`);
    console.log(`   !avatarSpeaking: ${conditions.notAvatarSpeaking}`);
    console.log(`   !micPausedForAvatar: ${conditions.notMicPaused}`);
    console.log(`   isAlwaysListening: ${conditions.alwaysListening}`);
    
    if (conditions.conversationMode && conditions.voiceEnabled && conditions.notAvatarSpeaking && 
        conditions.notMicPaused && conditions.alwaysListening) {
      console.log('✅ ALWAYS-ON CONDITIONS MET - STARTING LISTENING...');
      
      try {
        // setIsRestarting(true);
        // Use standard recording method for reliability
        // await startRecording();
        // console.log('✅ Always-on listening started successfully');
      } catch (error) {
        console.error('❌ Failed to start always-on listening:', error);
        // Try again after a longer delay to prevent rapid loops
        setTimeout(() => {
          if (conversationMode === 'always_on' && voiceModeEnabled) {
            console.log('🔄 Retrying always-on listening...');
            startAlwaysOnListening();
          }
        }, 3000);
      } finally {
        setIsRestarting(false);
      }
    } else {
      console.log('🚫 ALWAYS-ON CONDITIONS NOT MET - SKIPPING');
      if (!conditions.conversationMode) console.log('   Reason: Not always-on mode');
      if (!conditions.voiceEnabled) console.log('   Reason: Voice not enabled');
      if (!conditions.notAvatarSpeaking) console.log('   Reason: Avatar is speaking');
      if (!conditions.notMicPaused) console.log('   Reason: Mic paused for avatar');
      if (!conditions.alwaysListening) console.log('   Reason: Not always listening');
    }

    console.log('🎤 ALWAYS-ON LISTENING CHECK:');
    console.log(`   Mode: ${conversationMode}`);
    console.log(`   Voice Enabled: ${voiceModeEnabled}`);
    console.log(`   Avatar Speaking: ${avatarSpeaking}`);
    console.log(`   Mic Paused for Avatar: ${micPausedForAvatar}`);
    console.log(`   Recording: ${isRecording}`);
    console.log(`   Always Listening: ${isAlwaysListening}`);
    console.log(`   Is Restarting: ${isRestarting}`);
  };

  const toggleConversationMode = () => {
    const modes: Array<'always_on' | 'continuous' | 'push_to_talk'> = ['always_on', 'continuous', 'push_to_talk'];
    const currentIndex = modes.indexOf(conversationMode);
    const newMode = modes[(currentIndex + 1) % modes.length];
    
    console.log(`🔄 CONVERSATION MODE CHANGE: ${conversationMode} → ${newMode}`);
    setConversationMode(newMode);
    
    if (newMode === 'always_on' && voiceModeEnabled) {
      console.log('⏰ Starting always-on mode...');
      setIsAlwaysListening(true);
      setTimeout(() => {
        console.log('🚀 ALWAYS-ON: Starting listening...');
        startAlwaysOnListening();
      }, 200);
    } else if (newMode === 'continuous' && voiceModeEnabled) {
      console.log('⏰ Scheduling continuous mode startup...');
      setIsAlwaysListening(false);
      setTimeout(() => {
        console.log('🚀 Starting continuous mode...');
        startContinuousListening();
      }, 500);
    } 
  };

// 👇 Only the relevant updated section of `sendVoiceMessage` is revised
  const sendVoiceMessage = async (transcribedText: string) => {
    try {
      console.log('🚀 SENDING VOICE MESSAGE TO AI:');
      console.log(`   Message: "${transcribedText}"`);
      console.log(`   Length: ${transcribedText.length} characters`);
      console.log(`   Session ID: ${sessionId}`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);

      console.log('🎤 Sending voice message...');

      // ✅ Preemptively mute microphone before making the API call
      if (echoPreventionEnabled) {
        console.log('🎤 Echo prevention enabled - muting microphone BEFORE speaking starts');
        muteMicrophone();
      }

      // Clear any interim results
      setRecognizedText('');

      const requestBody = {
        session_id: sessionId,
        text: transcribedText,
        task_type: "talk",
      };

      console.log('📤 API Request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(
        `${API_CONFIG.serverUrl}/v1/streaming.task`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(requestBody),
        }
      );

      const data = await response.json();
      console.log('📥 AI RESPONSE RECEIVED');
      console.log('🗣️ Avatar will start speaking now...');
      setText("");

      if (echoPreventionEnabled) {
        const estimatedWords = transcribedText.length / 5;
        const estimatedSpeakingTime = Math.max(3000, (estimatedWords / 120) * 60 * 1000);
        const bufferTime = 2000;
        const totalWaitTime = estimatedSpeakingTime + bufferTime;

        console.log(`⏱️ Auto-resume timer: ${Math.round(totalWaitTime / 1000)}s`);

        setTimeout(() => {
          console.log('⏱️ Auto-resume timer fired - unmuting microphone');
          unmuteMicrophone();
        }, totalWaitTime);
      }
    } catch (error) {
      console.error('❌ ERROR SENDING VOICE MESSAGE:', error);
      unmuteMicrophone();
    }
  };

  // Function to handle when avatar finishes speaking
  const onAvatarFinishedSpeaking = () => {
    console.log('✅ AVATAR FINISHED SPEAKING');
    unmuteMicrophone();
  };

  const closeSession = async () => {
    try {
      setLoading(true);
      if (!sessionId || !sessionToken) {
        console.log("No active session");
        return;
      }

      const response = await fetch(
        `${API_CONFIG.serverUrl}/v1/streaming.stop`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
          }),
        }
      );

      // Close WebSocket
      if (webSocket) {
        webSocket.close();
        setWebSocket(null);
      }

      // Reset all states
      setConnected(false);
      setSessionId("");
      setSessionToken("");
      setWsUrl("");
      setToken("");
      setText("");

      setSessionInitialized(false);

      console.log("Session closed successfully");
      
      // Call the onSessionEnd callback to return to meditation view
      onSessionEnd?.();
    } catch (error) {
      console.error("Error closing session:", error);
    } finally {
      setLoading(false);
    }
  };

  // Microphone test function for Android TV debugging
  const testMicrophoneForTV = async () => {
    try {
      console.log('🎤 Testing microphone for Android TV...');
      
      // Test permissions
      const audioPermission = await Audio.requestPermissionsAsync();
      const speechPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      
      console.log('Permissions:', {
        audio: audioPermission.status,
        speech: speechPermission.granted
      });
      
      if (audioPermission.status !== 'granted' || !speechPermission.granted) {
        Alert.alert('Permissions Required', 'Microphone and speech recognition permissions are needed.');
        return;
      }
      
      // Test audio configuration
      if (Platform.OS === 'android' && Platform.isTV) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('✅ Android TV audio mode configured');
      }
      
      // Test speech recognition
      const isAvailable = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!isAvailable) {
        Alert.alert('Speech Recognition Not Available', 'Speech recognition is not available on this device.');
        return;
      }
      
      // Start a quick test
      const testConfig = {
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
      };
      
      ExpoSpeechRecognitionModule.start(testConfig);
      
      // Stop after 5 seconds
      setTimeout(() => {
        ExpoSpeechRecognitionModule.stop();
        Alert.alert('Test Complete', 'Microphone test completed. Check console for details.');
      }, 5000);
      
    } catch (error) {
      console.error('❌ Microphone test failed:', error);
      Alert.alert('Test Failed', `Microphone test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Centralized microphone muting functions
  const muteMicrophone = async () => {
    try {
      console.log('🔇 MUTING MICROPHONE...');
      
      // 1. Stop any active speech recognition (this prevents echo)
      if (isRecording) {
        console.log('🛑 Stopping speech recognition...');
        ExpoSpeechRecognitionModule.stop();
        // setIsRecording(false);
        setIsListening(false);
      }
      
      // 2. Set microphone paused state
      setMicPausedForAvatar(true);
      
      // 3. Clear any pending speech recognition results
      setRecognizedText('');
      
      console.log('✅ Microphone muted successfully (speech recognition stopped)');
    } catch (error) {
      console.error('❌ Error muting microphone:', error);
    }
  };

  const unmuteMicrophone = async () => {
    try {
      console.log('🔊 UNMUTING MICROPHONE...');
      
      // 1. Reset microphone paused state
      setMicPausedForAvatar(false);
      
      // 2. Resume listening if in always-on mode
      if (conversationMode === 'always_on' && voiceModeEnabled) {
        console.log('🔄 Resuming listening after unmute...');
        startAlwaysOnListening();
      }
      
      console.log('✅ Microphone unmuted successfully (speech recognition will resume)');
    } catch (error) {
      console.error('❌ Error unmuting microphone:', error);
    }
  };

  // TV-Specific Error Handling
  const handleTVMicrophoneError = (error: any) => {
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
    
    Alert.alert(
      'Voice Chat Error',
      `${errorMessage}\n\n${suggestion}`,
      [
        { text: 'Retry', onPress: () => startRecording() },
        { text: 'Disable Voice', onPress: () => setVoiceModeEnabled(false) },
      ]
    );
  };

  // Enhanced Microphone Detection for TV
  const detectTVMicrophone = async () => {
    try {
      console.log('🔍 Detecting TV microphone capabilities...');
      
      // Check if device has microphone
      const hasAudioInputFeature = await ExpoSpeechRecognitionModule.getAvailableVoices();
      
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
  };

  // TV-Specific UI Adjustments
  const getTVFriendlyStyles = () => {
    if (Platform.OS === 'android' && Platform.isTV) {
      return {
        // Larger touch targets for TV remote navigation
        voiceButton: {
          minWidth: 300, // Larger for TV
          paddingVertical: 20,
        },
        // High contrast text for TV viewing distance
        voiceModeText: {
          fontSize: 24, // Larger for TV
          fontWeight: '700',
        },
        // TV-friendly focus indicators
        focusedButton: {
          borderWidth: 3,
          borderColor: '#FFD700', // Gold border for focus
        },
      };
    }
    return {};
  };

  if (!connected || loading) {
    return (
      <View style={styles.startContainer}>
        <View style={styles.heroContainer}>
          <Text style={styles.heroTitle}>AI Therapy Session</Text>
        </View>
        
        <View style={styles.loadingIndicator}>
          <Text style={styles.loadingText}>
            {loading ? "Starting your therapy session..." : 
             sessionInitialized ? "Avatar is ready to speak..." : "Please wait..."}
          </Text>
          <View style={styles.spinnerContainer}>
            <ActivityIndicator size="large" color="#1a73e8" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={wsUrl}
      token={token}
      connect={true}
      options={{
        adaptiveStream: { pixelDensity: "screen" },
      }}
      audio={false}
      video={false}
    >
      <RoomView
        onClose={closeSession}
        loading={loading}
        microphoneState={{
          isRecording,
          isListening,
          avatarSpeaking,
          micPausedForAvatar,
          conversationMode,
          voiceModeEnabled,
          recognizedText,
          allSpeechResults,
        }}
      />
    </LiveKitRoom>
  );
}

interface MicrophoneState {
  isRecording: boolean;
  isListening: boolean;
  avatarSpeaking: boolean;
  micPausedForAvatar: boolean;
  conversationMode: string;
  voiceModeEnabled: boolean;
  recognizedText: string;
  allSpeechResults: string[];
}

const RoomView = ({
  onClose,
  loading,
  microphoneState,
}: {
  onClose: () => void;
  loading: boolean;
  microphoneState: MicrophoneState;
}) => {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const [isSystemMuted, setIsSystemMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // Check actual Android microphone mute status and audio level
  useEffect(() => {
    const checkMicrophoneStatus = async () => {
      if (Platform.OS === 'android') {
        try {
          const muted = await AudioControl.isSystemMuted();
          setIsSystemMuted(muted);
          
          // Get current system volume as a proxy for audio level
          const volume = await AudioControl.getSystemVolume();
          setAudioLevel(volume / 100); // Convert to 0-1 range
        } catch (error) {
          console.error('Failed to check microphone status:', error);
        }
      }
    };

    // Check immediately and then every 2 seconds
    checkMicrophoneStatus();
    const interval = setInterval(checkMicrophoneStatus, 2000);

    return () => clearInterval(interval);
  }, []);

  // Determine microphone status based on actual Android state
  const getMicrophoneStatus = () => {
    if (!microphoneState.voiceModeEnabled) return { status: 'DISABLED', color: '#999', text: 'Voice Disabled' };
    
    // Check actual Android microphone mute state
    if (Platform.OS === 'android' && isSystemMuted) {
      return { status: 'SYSTEM_MUTED', color: '#FF6B6B', text: 'System Muted' };
    }
    
    if (microphoneState.avatarSpeaking || microphoneState.micPausedForAvatar) return { status: 'MUTED', color: '#FF6B6B', text: 'Mic Muted' };
    if (microphoneState.isRecording && microphoneState.isListening) return { status: 'LISTENING', color: '#4CAF50', text: 'Listening' };
    if (microphoneState.conversationMode === 'always_on') return { status: 'STANDBY', color: '#FFA726', text: 'Standby' };
    return { status: 'OFF', color: '#999', text: 'Mic Off' };
  };

  const micStatus = getMicrophoneStatus();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.videoContainer}>
        {tracks.map((track, idx) =>
          isTrackReference(track) ? (
            <VideoTrack
              key={idx}
              style={styles.videoView}
              trackRef={track}
              objectFit="contain"
            />
          ) : null
        )}
      </View>
      
      {/* Speech Text Display */}
      <View style={styles.speechContainer}>
        <Text style={styles.speechTitle}>🎤 Speech Recognition:</Text>
        <View style={styles.speechTextContainer}>
          <Text style={styles.currentSpeechText}>
            {microphoneState.recognizedText || 'Listening...'}
          </Text>
        </View>
        
        {/* All Speech Results */}
        <Text style={styles.speechHistoryTitle}>All Results:</Text>
        <View style={styles.speechHistoryContainer}>
          {microphoneState.allSpeechResults.length > 0 ? (
            microphoneState.allSpeechResults.slice(-10).map((text, index) => (
              <Text key={index} style={styles.speechHistoryText}>
                • {text}
              </Text>
            ))
          ) : (
            <Text style={styles.noSpeechText}>No speech detected yet...</Text>
          )}
        </View>
      </View>
      
      {/* Microphone Status Button */}
      <View style={styles.statusContainer}>
        <View style={[styles.microphoneStatusButton, { backgroundColor: micStatus.color }]}>
          <Text style={styles.microphoneStatusText}>
            🎤 {micStatus.text}
          </Text>
        </View>
      </View>
      
      {/* Hidden close button for emergency use only */}
      <TouchableOpacity
        style={[styles.hiddenCloseButton, loading && styles.disabledButton]}
        onPress={onClose}
        disabled={loading}
      >
        <Text style={styles.hiddenCloseButtonText}>
          {loading ? "Ending..." : "End Session"}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
  },
  startContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
    padding: 20,
  },
  heroContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: "#A67B5B", // soft brown - matching HomeScreenView
    marginBottom: 8,
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: 18,
    color: "#5C4033", // darker brown - matching HomeScreenView
    fontWeight: "500",
    textAlign: "center",
  },
  loadingIndicator: {
    marginTop: 20,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 16,
    color: "#5C4033", // darker brown - matching HomeScreenView
    textAlign: "center",
    fontStyle: "italic",
  },
  spinnerContainer: {
    marginTop: 20,
    alignItems: "center",
  },
  startButton: {
    backgroundColor: "#A67B5B", // soft brown - matching HomeScreenView
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 30,
    elevation: 3,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  startButtonText: {
    color: "#FFF8F0", // light background - matching HomeScreenView
    fontSize: 18,
    fontWeight: "600",
  },
  videoContainer: {
    flex: 1,
    position: "relative",
  },
  videoView: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "#A67B5B", // soft brown - matching HomeScreenView
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    zIndex: 1,
    elevation: 3,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  closeButtonText: {
    color: "#FFF8F0", // light background - matching HomeScreenView
    fontSize: 16,
    fontWeight: "600",
  },
  hiddenCloseButton: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "rgba(166, 123, 91, 0.3)", // soft brown with opacity
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 1000,
    opacity: 0.1, // Nearly invisible
  },
  hiddenCloseButtonText: {
    color: "#FFF8F0", // light background - matching HomeScreenView
    fontSize: 12,
    fontWeight: "400",
  },
  controls: {
    width: "100%",
    padding: 20,
    borderTopWidth: 1,
    borderColor: "#A67B5B", // soft brown - matching HomeScreenView
    backgroundColor: "rgba(255, 248, 240, 0.95)", // light skin tone with opacity
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    height: 50,
    borderColor: "#A67B5B", // soft brown - matching HomeScreenView
    borderWidth: 1,
    paddingHorizontal: 15,
    borderRadius: 25,
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
    fontSize: 16,
    color: "#5C4033", // darker brown - matching HomeScreenView
  },
  sendButton: {
    backgroundColor: "#A67B5B", // soft brown - matching HomeScreenView
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 3,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  sendButtonText: {
    color: "#FFF8F0", // light background - matching HomeScreenView
    fontSize: 16,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.5,
  },
  // Voice Recording Styles
  voiceContainer: {
    alignItems: "center",
    paddingVertical: 10,
  },
  voiceModeText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#A67B5B", // soft brown - matching HomeScreenView
    marginBottom: 15,
    textAlign: "center",
  },
  voiceButtonContainer: {
    alignItems: "center",
    marginBottom: 10,
  },
  voiceButton: {
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    elevation: 3,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    minWidth: 200,
    alignItems: "center",
  },
  voiceButtonActive: {
    backgroundColor: "#A67B5B", // soft brown when recording - matching HomeScreenView
  },
  voiceButtonInactive: {
    backgroundColor: "#F5DEB3", // goldish when not recording - matching HomeScreenView
  },
  voiceButtonText: {
    color: "#5C4033", // darker brown - matching HomeScreenView
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  recordingIndicator: {
    fontSize: 16,
    color: "#A67B5B", // soft brown - matching HomeScreenView
    fontWeight: "600",
    marginTop: 10,
    textAlign: "center",
    fontStyle: "italic",
  },
  speakingIndicator: {
    fontSize: 16,
    color: "#8BC34A", // light green - keeping some green for speaking
    fontWeight: "600",
    marginTop: 10,
    textAlign: "center",
    fontStyle: "italic",
  },
  recognitionContainer: {
    alignItems: "center",
    marginTop: 10,
  },
  recognizedText: {
    fontSize: 14,
    color: "#5C4033", // darker brown - matching HomeScreenView
    fontStyle: "italic",
    marginTop: 5,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  // Enhanced Voice Chat Styles
  voiceHeaderContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
    paddingHorizontal: 10,
  },
  modeToggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 2,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  continuousModeButton: {
    backgroundColor: "#A67B5B", // soft brown - matching HomeScreenView
  },
  pushToTalkModeButton: {
    backgroundColor: "#F5DEB3", // goldish - matching HomeScreenView
  },
  alwaysOnModeButton: {
    backgroundColor: "#8BC34A", // light green for always-on mode
  },
  modeToggleText: {
    color: "#5C4033", // darker brown - matching HomeScreenView
    fontSize: 12,
    fontWeight: "600",
  },
  continuousIndicatorContainer: {
    alignItems: "center",
    marginBottom: 10,
  },
  continuousIndicator: {
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 200,
    alignItems: "center",
    position: "relative",
    borderWidth: 2,
    borderColor: "#A67B5B", // soft brown - matching HomeScreenView
  },
  continuousIndicatorActive: {
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
    borderColor: "#A67B5B", // soft brown - matching HomeScreenView
  },
  alwaysOnIndicator: {
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
    borderColor: "#8BC34A", // light green for always-on mode
  },
  alwaysOnStatusContainer: {
    alignItems: "center",
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 8,
    backgroundColor: "#FFF8F0", // light skin tone - matching HomeScreenView
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#A67B5B", // soft brown - matching HomeScreenView
  },
  alwaysOnStatusText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#5C4033", // darker brown - matching HomeScreenView
    textAlign: "center",
    marginBottom: 5,
  },
  resumeMicButton: {
    backgroundColor: "#A67B5B", // soft brown - matching HomeScreenView
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 5,
  },
  resumeMicButtonText: {
    color: "#FFF8F0", // light background - matching HomeScreenView
    fontSize: 12,
    fontWeight: "600",
  },
  continuousIndicatorText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#5C4033", // darker brown - matching HomeScreenView
  },
  audioLevelBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: 3,
    backgroundColor: "#A67B5B", // soft brown - matching HomeScreenView
    borderRadius: 1.5,
  },
  debugButton: {
    backgroundColor: "#F5DEB3", // goldish - matching HomeScreenView
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 20,
  },
  debugButtonText: {
    color: "#5C4033", // darker brown - matching HomeScreenView
    fontSize: 14,
    fontWeight: "600",
  },
  debugInfo: {
    marginTop: 20,
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.1)",
    borderRadius: 10,
  },
  debugText: {
    fontSize: 12,
    color: "#666",
    marginBottom: 5,
  },
  // Microphone Status Button Styles
  statusContainer: {
    position: "absolute",
    top: 50,
    left: 20,
    zIndex: 1000,
  },
  microphoneStatusButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  microphoneStatusText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  // Speech Display Styles
  speechContainer: {
    position: "absolute",
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 15,
    borderRadius: 10,
    zIndex: 1000,
    maxHeight: 300,
  },
  speechTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#A67B5B",
    marginBottom: 10,
  },
  speechTextContainer: {
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    minHeight: 40,
  },
  currentSpeechText: {
    fontSize: 14,
    color: "#333",
    fontStyle: "italic",
  },
  speechHistoryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 5,
  },
  speechHistoryContainer: {
    maxHeight: 150,
  },
  speechHistoryText: {
    fontSize: 12,
    color: "#333",
    marginBottom: 2,
  },
  noSpeechText: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
  },
});
