import { useEffect, useState } from "react";
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
} from "react-native";
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

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

interface InteractiveAvatarProps {
  onSessionEnd?: () => void;
  userId?: string | null;
  therapistName?: string | null;
}

export default function InteractiveAvatar({ onSessionEnd, userId, therapistName }: InteractiveAvatarProps) {
  const [wsUrl, setWsUrl] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [sessionToken, setSessionToken] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState("");
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
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
  
  // Enhanced echo prevention state
  const [lastAvatarSpeechEnd, setLastAvatarSpeechEnd] = useState<number>(0);
  const [micCooldownPeriod, setMicCooldownPeriod] = useState(2000); // 2 seconds cooldown
  const [echoDetectionThreshold, setEchoDetectionThreshold] = useState(0.4);
  const [isInEchoCooldown, setIsInEchoCooldown] = useState(false);
  
  // UI Debug state for microphone status
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  const [micStatus, setMicStatus] = useState<'ON' | 'OFF' | 'PAUSED' | 'COOLDOWN'>('OFF');

  // Start audio session and auto-start HeyGen session
  useEffect(() => {
    const setupAudio = async () => {
      // Enhanced audio configuration for TV environments to prevent echo
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true, // Duck other audio when recording
          playThroughEarpieceAndroid: false, // Use speakers for TV
          // Additional TV-specific settings
          interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
          interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
        });
        console.log('✅ Enhanced audio mode configured for TV echo prevention');
      } catch (error) {
        console.error('❌ Failed to configure enhanced audio mode:', error);
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
    
    // Start always-on listening after a longer delay to ensure audio setup is complete
    setTimeout(() => {
      if (voiceModeEnabled && conversationMode === 'always_on') {
        console.log('🚀 Initial setup: Starting always-on listening...');
        startAlwaysOnListening();
      }
    }, 5000); // Increased delay for better audio setup

    // Set up periodic microphone health check for always-on mode
    const microphoneHealthCheck = setInterval(() => {
      if (conversationMode === 'always_on' && voiceModeEnabled && !avatarSpeaking && !micPausedForAvatar && !isRecording && !isInEchoCooldown) {
        console.log('🔍 Health check: Ensuring microphone is active...');
        startAlwaysOnListening();
      }
    }, 15000); // Increased interval to 15 seconds to reduce conflicts
    
    // Set up avatar speaking timeout check
    const avatarSpeakingTimeoutCheck = setInterval(() => {
      if (avatarSpeaking && avatarSpeakingStartTime) {
        const speakingDuration = Date.now() - avatarSpeakingStartTime;
        const maxSpeakingTime = 45000; // Increased to 45 seconds max
        
        if (speakingDuration > maxSpeakingTime) {
          console.log('⏰ Avatar speaking timeout - resetting state');
          setAvatarSpeaking(false);
          setMicPausedForAvatar(false);
          setAvatarSpeakingStartTime(null);
          setSpeaking(false);
          
          // Resume listening if needed with longer cooldown
          if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording) {
            console.log('🔄 Resuming listening after timeout with cooldown');
            setTimeout(() => {
              if (!avatarSpeaking && !micPausedForAvatar && !isInEchoCooldown) {
                startAlwaysOnListening();
              }
            }, micCooldownPeriod);
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
    };
  }, []);

  // Enhanced echo prevention function
  const isInEchoCooldownPeriod = () => {
    const timeSinceLastAvatarSpeech = Date.now() - lastAvatarSpeechEnd;
    return timeSinceLastAvatarSpeech < micCooldownPeriod;
  };

  // Simple debug logging function for UI
  const addDebugLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(logEntry);
    // Only keep logs in console, not in UI for simplicity
  };

  // Speech recognition event handlers
  useSpeechRecognitionEvent("start", () => {
    console.log('🎤 SPEECH RECOGNITION STARTED');
    console.log(`📊 Mode: ${conversationMode}, Voice Enabled: ${voiceModeEnabled}`);
    console.log(`🛡️ Echo Cooldown: ${isInEchoCooldownPeriod() ? 'ACTIVE' : 'INACTIVE'}`);
    setIsRecording(true);
    setIsListening(true);
    setMicStatus('ON');
    addDebugLog('🎤 MICROPHONE TURNED ON');
  });

  useSpeechRecognitionEvent("audiostart", () => {
    console.log('🎙️ AUDIO CAPTURE STARTED');
  });

  useSpeechRecognitionEvent("audioend", () => {
    console.log('🎙️ AUDIO CAPTURE ENDED');
  });

  useSpeechRecognitionEvent("end", () => {
    console.log('🛑 SPEECH RECOGNITION ENDED');
    console.log(`📊 Mode: ${conversationMode}, Speaking: ${speaking}, Always Listening: ${isAlwaysListening}`);
    setIsRecording(false);
    setIsListening(false);
    
    // Enhanced echo prevention: check cooldown period
    if (isInEchoCooldownPeriod()) {
      console.log('🚫 ECHO PREVENTION: In cooldown period, not restarting');
      setMicStatus('COOLDOWN');
      addDebugLog('🚫 MICROPHONE IN COOLDOWN - NOT RESTARTING');
      return;
    }
    
    // CRITICAL: Don't restart if avatar is speaking to prevent echo
    if (avatarSpeaking || micPausedForAvatar) {
      console.log('🚫 ECHO PREVENTION: Not restarting while avatar is speaking');
      setMicStatus('PAUSED');
      addDebugLog('🚫 MICROPHONE PAUSED - AVATAR SPEAKING');
      return;
    }
    
    setMicStatus('OFF');
    addDebugLog('🛑 MICROPHONE TURNED OFF');
    
    // Always restart for always-on mode unless avatar is speaking
    if (conversationMode === 'always_on' && isAlwaysListening && !avatarSpeaking && !micPausedForAvatar && voiceModeEnabled && !isInEchoCooldownPeriod()) {
      console.log('🔄 ALWAYS-ON: Restarting microphone after cooldown check...');
      addDebugLog('🔄 SCHEDULING MICROPHONE RESTART (500ms)');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar && !isInEchoCooldownPeriod() && conversationMode === 'always_on') {
          console.log('🎤 ALWAYS-ON: Starting new listening session...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping restart - conditions not met');
          addDebugLog('🚫 SKIPPING RESTART - CONDITIONS NOT MET');
        }
      }, 500); // Increased delay for better echo prevention
    }
    // In continuous mode, restart listening after a longer pause if not speaking
    else if (conversationMode === 'continuous' && !speaking && voiceModeEnabled && !isInEchoCooldownPeriod()) {
      console.log('⏰ Scheduling restart in 2 seconds...');
      addDebugLog('🔄 SCHEDULING MICROPHONE RESTART (2s)');
      setTimeout(() => {
        if (!speaking && !isInEchoCooldownPeriod()) {
          console.log('🔄 Auto-restarting continuous listening...');
          startContinuousListening();
        } else {
          console.log('🚫 Skipping restart - AI is speaking or in cooldown');
          addDebugLog('🚫 SKIPPING RESTART - AI SPEAKING OR COOLDOWN');
        }
      }, 2000); // Increased delay
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.error('❌ SPEECH RECOGNITION ERROR:');
    console.error(`   Error: ${event.error}`);
    console.error(`   Message: ${event.message}`);
    console.error(`   Mode: ${conversationMode}, Speaking: ${speaking}`);
    setIsRecording(false);
    setIsListening(false);
    setRecognizedText('');
    
    // In always-on mode, try to restart after error if avatar not speaking and not in cooldown
    if (conversationMode === 'always_on' && isAlwaysListening && !avatarSpeaking && voiceModeEnabled && !isInEchoCooldownPeriod()) {
      console.log('⏰ ALWAYS-ON: Scheduling error recovery restart in 1000ms...');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar && isAlwaysListening && conversationMode === 'always_on' && !isInEchoCooldownPeriod()) {
          console.log('🔄 ALWAYS-ON: Attempting error recovery restart...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping error recovery - conditions not met');
        }
      }, 1000); // Increased delay
    }
    // In continuous mode, try to restart after error
    else if (conversationMode === 'continuous' && voiceModeEnabled && !isInEchoCooldownPeriod()) {
      console.log('⏰ Scheduling error recovery restart in 3 seconds...');
      setTimeout(() => {
        if (!speaking && !isInEchoCooldownPeriod()) {
          console.log('🔄 Attempting error recovery restart...');
          startContinuousListening();
        } else {
          console.log('🚫 Skipping error recovery - AI is speaking or in cooldown');
        }
      }, 3000); // Increased delay
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    console.log('🗣️ SPEECH RESULT RECEIVED:');
    console.log(`   Results count: ${event.results?.length || 0}`);
    console.log(`   Is Final: ${event.isFinal}`);
    
    // Enhanced echo prevention: check cooldown period first
    if (isInEchoCooldownPeriod()) {
      console.log('🚫 ECHO PREVENTION: In cooldown period, ignoring speech');
      return;
    }
    
    // CRITICAL: Don't process speech when avatar is speaking to prevent echo
    if (echoPreventionEnabled && (avatarSpeaking || micPausedForAvatar)) {
      console.log('🚫 ECHO PREVENTION: Ignoring speech while avatar is speaking');
      return;
    }
    
    // Additional echo prevention: check if the transcribed text might be the avatar's speech
    if (event.results && event.results.length > 0) {
      const result = event.results[0];
      const transcribedText = result.transcript;
      const confidence = result.confidence;
      
      console.log('📝 DETECTED SPEECH:');
      console.log(`   Text: "${transcribedText}"`);
      console.log(`   Confidence: ${confidence || 'N/A'}`);
      console.log(`   Length: ${transcribedText.length} characters`);
      console.log(`   Is Final: ${event.isFinal ? 'YES' : 'NO (interim)'}`);
      
      // Enhanced echo detection: check for common avatar speech patterns
      if (echoPreventionEnabled && avatarSpeaking) {
        const lowerText = transcribedText.toLowerCase();
        const isLikelyEcho = (
          (lowerText.includes('hello') && lowerText.includes('therapist')) ||
          (lowerText.includes('how are you feeling') && lowerText.includes('today')) ||
          (lowerText.includes('therapy session') && lowerText.includes('i\'m here')) ||
          (lowerText.includes('thank you') && lowerText.includes('sharing')) ||
          (lowerText.includes('that sounds') && lowerText.includes('difficult')) ||
          (confidence && confidence < 0.3) // Increased threshold for better detection
        );
        
        if (isLikelyEcho) {
          console.log('🚫 ENHANCED ECHO DETECTION: Likely avatar speech detected, ignoring');
          setRecognizedText(''); // Clear any pending text
          return;
        }
      }
      
      setRecognizedText(transcribedText);
      
      // Only send final results to avoid spamming
      if (event.isFinal) {
        // Filter out very short utterances that might be noise
        if (transcribedText.trim().length >= 3) {
          console.log('✅ SENDING FINAL RESULT TO HEYGEN AI');
          sendVoiceMessage(transcribedText);
          setRecognizedText(''); // Clear after sending
        } else {
          console.log('🚫 Skipping short utterance (likely noise)');
          setRecognizedText(''); // Clear anyway
        }
      } else {
        console.log('⏳ Interim result - waiting for final...');
      }
    } else {
      console.log('⚠️ No speech results in event');
    }
  });

  // Enhanced audio level monitoring for voice activity detection and echo prevention
  useSpeechRecognitionEvent("volumechange", (event) => {
    if (event.value !== undefined) {
      // Only log significant audio level changes to avoid spam
      if (event.value > 0.1) {
        console.log(`🎚️ Audio Level: ${(event.value * 100).toFixed(1)}%`);
      }
      setAudioLevel(event.value);
      
      // Enhanced echo prevention: if audio level is high and avatar is speaking, it might be echo
      if (echoPreventionEnabled && event.value > echoDetectionThreshold && avatarSpeaking) {
        console.log('🚫 ENHANCED ECHO DETECTION: High audio level during avatar speech - possible echo');
        // Stop processing this audio and enter cooldown
        setIsInEchoCooldown(true);
        setTimeout(() => {
          setIsInEchoCooldown(false);
        }, micCooldownPeriod);
        return;
      }
      
      // Auto-resume microphone if audio level is high but not listening (for natural conversation)
      if (event.value > 0.3 && !isListening && conversationMode === 'always_on' && !avatarSpeaking && !micPausedForAvatar && !isInEchoCooldownPeriod()) {
        console.log('🎤 High audio level detected - ensuring microphone is active...');
        startAlwaysOnListening();
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
        
        // Enhanced WebSocket message handling to prevent echo
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('📥 WebSocket message received:', JSON.stringify(data, null, 2));
            
            // Handle avatar speaking events to prevent echo
            if (data.type === 'avatar_speaking' || data.type === 'speech_start' || data.event === 'avatar_speaking') {
              console.log('🗣️ Avatar started speaking - pausing microphone with enhanced echo prevention');
              setAvatarSpeaking(true);
              setMicPausedForAvatar(true);
              setAvatarSpeakingStartTime(Date.now());
              setMicStatus('PAUSED');
              addDebugLog('🗣️ AVATAR STARTED SPEAKING - MICROPHONE PAUSED');
              
              // Stop speech recognition immediately if echo prevention is enabled
              if (echoPreventionEnabled && isRecording) {
                console.log('🛑 Stopping speech recognition due to avatar speaking');
                addDebugLog('🛑 STOPPING SPEECH RECOGNITION - AVATAR SPEAKING');
                try {
                  ExpoSpeechRecognitionModule.stop();
                  setIsRecording(false);
                  setIsListening(false);
                  setRecognizedText(''); // Clear any pending speech
                } catch (error) {
                  console.error('❌ Error stopping speech recognition:', error);
                  addDebugLog('❌ ERROR STOPPING SPEECH RECOGNITION');
                }
              }
            }
            
            // Handle avatar finished speaking events with enhanced cooldown
            if (data.type === 'avatar_finished' || data.type === 'speech_end' || data.event === 'avatar_finished') {
              console.log('✅ Avatar finished speaking - entering cooldown period');
              setAvatarSpeaking(false);
              setMicPausedForAvatar(false);
              setAvatarSpeakingStartTime(null);
              setLastAvatarSpeechEnd(Date.now());
              setMicStatus('COOLDOWN');
              addDebugLog('✅ AVATAR FINISHED SPEAKING - ENTERING COOLDOWN');
              
              // Enhanced echo prevention: longer cooldown period
              if (echoPreventionEnabled) {
                console.log(`⏱️ Starting ${micCooldownPeriod}ms echo cooldown period`);
                addDebugLog(`⏱️ STARTING ${micCooldownPeriod}ms ECHO COOLDOWN`);
                setTimeout(() => {
                  if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording && !avatarSpeaking) {
                    console.log('🔄 Resuming listening after echo cooldown period');
                    addDebugLog('🔄 RESUMING LISTENING AFTER COOLDOWN');
                    startAlwaysOnListening();
                  }
                }, micCooldownPeriod);
              }
            }
            
            // Handle task completion events with enhanced cooldown
            if (data.type === 'task_completed' || data.event === 'task_completed') {
              console.log('✅ Task completed - avatar should be finished speaking');
              setAvatarSpeaking(false);
              setMicPausedForAvatar(false);
              setSpeaking(false);
              setLastAvatarSpeechEnd(Date.now());
              
              // Enhanced echo prevention: longer cooldown period
              if (echoPreventionEnabled) {
                console.log(`⏱️ Starting ${micCooldownPeriod}ms echo cooldown period after task completion`);
                setTimeout(() => {
                  if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording && !avatarSpeaking) {
                    console.log('🔄 Resuming listening after task completion cooldown');
                    startAlwaysOnListening();
                  }
                }, micCooldownPeriod);
              }
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
                setAvatarSpeaking(false);
                setSpeaking(false);
                setMicPausedForAvatar(false);
                setIsAlwaysListening(true);
                startAlwaysOnListening();
              }, 8000); // Increased delay to give avatar more time to speak the greeting
            } else if (conversationMode === 'continuous' && voiceModeEnabled) {
              setTimeout(() => {
                startContinuousListening();
              }, 5000);
            }
          } catch (error) {
            console.error("Error sending initial greeting:", error);
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
      setSpeaking(true);

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
      setSpeaking(false);
    }
  };

  // Voice recognition functions
  const startRecording = async () => {
    try {
      console.log('🎤 STARTING SPEECH RECOGNITION...');
      console.log(`📊 Current Settings:`);
      console.log(`   Mode: ${conversationMode}`);
      console.log(`   Voice Enabled: ${voiceModeEnabled}`);
      console.log(`   Currently Speaking: ${speaking}`);
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
      
      // Configure for continuous recognition based on documentation
      const config = {
        lang: 'en-US',
        interimResults: true,
        continuous: true, // Always use continuous for always-on mode
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false, // Use cloud recognition for better reliability
      };
      
      console.log('🔧 Speech Recognition Config:');
      console.log(JSON.stringify(config, null, 2));
      
      // Start speech recognition with expo-speech-recognition
      ExpoSpeechRecognitionModule.start(config);
      
      console.log('✅ SPEECH RECOGNITION STARTED - SPEAK NOW!');
    } catch (error) {
      console.error('❌ FAILED TO START SPEECH RECOGNITION:', error);
      Alert.alert('Speech Recognition Error', 'Failed to start speech recognition. Please try again.');
      setIsRecording(false);
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
    console.log(`   Speaking: ${speaking}`);
    console.log(`   Recording: ${isRecording}`);
    
    if (conversationMode === 'continuous' && voiceModeEnabled && !speaking && !isRecording) {
      console.log('✅ CONDITIONS MET - STARTING CONTINUOUS LISTENING...');
      await startRecording();
    } else {
      console.log('🚫 CONDITIONS NOT MET - SKIPPING CONTINUOUS LISTENING');
    }
  };

  const startAlwaysOnListening = async () => {
    console.log('🎤 ALWAYS-ON LISTENING CHECK:');
    console.log(`   Mode: ${conversationMode}`);
    console.log(`   Voice Enabled: ${voiceModeEnabled}`);
    console.log(`   Avatar Speaking: ${avatarSpeaking}`);
    console.log(`   Mic Paused for Avatar: ${micPausedForAvatar}`);
    console.log(`   Recording: ${isRecording}`);
    console.log(`   Always Listening: ${isAlwaysListening}`);
    console.log(`   Echo Cooldown: ${isInEchoCooldownPeriod() ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`   In Echo Cooldown: ${isInEchoCooldown ? 'YES' : 'NO'}`);
    
    if (conversationMode === 'always_on' && voiceModeEnabled && !avatarSpeaking && !micPausedForAvatar && !isRecording && isAlwaysListening && !isInEchoCooldownPeriod() && !isInEchoCooldown) {
      console.log('✅ ALWAYS-ON CONDITIONS MET - STARTING LISTENING...');
      
      try {
        // Use standard recording method for reliability
        await startRecording();
        console.log('✅ Always-on listening started');
      } catch (error) {
        console.error('❌ Failed to start always-on listening:', error);
        // Try again after a longer delay for better echo prevention
        setTimeout(() => {
          if (conversationMode === 'always_on' && voiceModeEnabled && !isInEchoCooldownPeriod()) {
            console.log('🔄 Retrying always-on listening...');
            startAlwaysOnListening();
          }
        }, 2000); // Increased delay
      }
    } else {
      console.log('🚫 ALWAYS-ON CONDITIONS NOT MET - SKIPPING');
      if (avatarSpeaking) console.log('   Reason: Avatar is speaking');
      if (micPausedForAvatar) console.log('   Reason: Mic paused for avatar');
      if (isInEchoCooldownPeriod()) console.log('   Reason: In echo cooldown period');
      if (isInEchoCooldown) console.log('   Reason: In echo cooldown state');
    }
  };

  const toggleConversationMode = () => {
    const modes: Array<'always_on' | 'continuous' | 'push_to_talk'> = ['always_on', 'continuous', 'push_to_talk'];
    const currentIndex = modes.indexOf(conversationMode);
    const newMode = modes[(currentIndex + 1) % modes.length];
    
    console.log(`🔄 CONVERSATION MODE CHANGE: ${conversationMode} → ${newMode}`);
    setConversationMode(newMode);
    
    if (newMode === 'always_on' && voiceModeEnabled && !speaking) {
      console.log('⏰ Starting always-on mode...');
      setIsAlwaysListening(true);
      setTimeout(() => {
        console.log('🚀 ALWAYS-ON: Starting listening...');
        startAlwaysOnListening();
      }, 200);
    } else if (newMode === 'continuous' && voiceModeEnabled && !speaking) {
      console.log('⏰ Scheduling continuous mode startup...');
      setIsAlwaysListening(false);
      setTimeout(() => {
        console.log('🚀 Starting continuous mode...');
        startContinuousListening();
      }, 500);
    } else if (newMode === 'push_to_talk') {
      console.log('🛑 Switching to push-to-talk mode...');
      setIsAlwaysListening(false);
      if (isRecording) {
        stopRecording();
      }
    }
  };

  const sendVoiceMessage = async (transcribedText: string) => {
    try {
      console.log('🚀 SENDING VOICE MESSAGE TO AI:');
      console.log(`   Message: "${transcribedText}"`);
      console.log(`   Length: ${transcribedText.length} characters`);
      console.log(`   Session ID: ${sessionId}`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);
      
      // Set speaking state but don't immediately pause microphone
      // Let the WebSocket events handle the actual avatar speaking state
      console.log('🎤 Setting speaking state...');
      setSpeaking(true);
      
      // Enhanced echo prevention: pause microphone immediately
      if (echoPreventionEnabled) {
        console.log('🎤 Enhanced echo prevention enabled - pausing microphone...');
        setAvatarSpeaking(true);
        setMicPausedForAvatar(true);
        
        // Stop speech recognition immediately and clear any pending results
        if (isRecording) {
          console.log('🛑 Stopping speech recognition immediately...');
          try {
            ExpoSpeechRecognitionModule.stop();
            setIsRecording(false);
            setIsListening(false);
            setRecognizedText(''); // Clear any pending speech
          } catch (error) {
            console.error('❌ Error stopping speech recognition:', error);
          }
        }
        
        // Set cooldown period immediately
        setIsInEchoCooldown(true);
        setTimeout(() => {
          setIsInEchoCooldown(false);
        }, micCooldownPeriod);
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
      setText(""); // Clear any text input
      
      // Enhanced auto-resume microphone with longer delay and cooldown consideration
      if (echoPreventionEnabled) {
        const estimatedWords = transcribedText.length / 5;
        const estimatedSpeakingTime = Math.max(5000, (estimatedWords / 120) * 60 * 1000); // Increased minimum time
        const bufferTime = 3000; // Increased buffer time
        const totalWaitTime = estimatedSpeakingTime + bufferTime + micCooldownPeriod; // Include cooldown period
        
        console.log(`⏱️ Enhanced auto-resume timer: ${Math.round(totalWaitTime/1000)}s (includes ${micCooldownPeriod/1000}s cooldown)`);
        
        setTimeout(() => {
          console.log('⏱️ Enhanced auto-resume timer fired - resetting avatar speaking state');
          setAvatarSpeaking(false);
          setSpeaking(false);
          setMicPausedForAvatar(false);
          setLastAvatarSpeechEnd(Date.now());
          
          // Resume listening if needed with additional cooldown check
          if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording && !isInEchoCooldownPeriod()) {
            console.log('🔄 Enhanced auto-resuming listening after timer and cooldown');
            startAlwaysOnListening();
          } else {
            console.log('🚫 Skipping auto-resume - conditions not met or in cooldown');
          }
        }, totalWaitTime);
      }
      
    } catch (error) {
      console.error('❌ ERROR SENDING VOICE MESSAGE:', error);
      // Reset avatar speaking state on error
      setAvatarSpeaking(false);
      setSpeaking(false);
      setMicPausedForAvatar(false);
      setIsInEchoCooldown(false);
    }
  };

  // Enhanced function to handle when avatar finishes speaking
  const onAvatarFinishedSpeaking = () => {
    console.log('✅ AVATAR FINISHED SPEAKING - Enhanced echo prevention');
    setAvatarSpeaking(false);
    setSpeaking(false);
    setLastAvatarSpeechEnd(Date.now());
    
    // Enhanced resume microphone with cooldown period
    if (conversationMode === 'always_on' && micPausedForAvatar && voiceModeEnabled) {
      console.log('🎤 ALWAYS-ON: Resuming microphone after avatar speech with cooldown...');
      setMicPausedForAvatar(false);
      
      // Enhanced delay with cooldown period to ensure echo prevention
      setTimeout(() => {
        if (!avatarSpeaking && conversationMode === 'always_on' && !isRecording && !isInEchoCooldownPeriod()) {
          console.log('🔄 ALWAYS-ON: Restarting listening after enhanced echo-safe delay...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping restart - conditions not met or in cooldown');
        }
      }, micCooldownPeriod); // Use cooldown period for better echo prevention
    } else if (conversationMode === 'continuous' && voiceModeEnabled && !isInEchoCooldownPeriod()) {
      setTimeout(() => {
        if (!isInEchoCooldownPeriod()) {
          startContinuousListening();
        }
      }, micCooldownPeriod);
    }
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
      setSpeaking(false);
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
        showDebugPanel={showDebugPanel}
        setShowDebugPanel={setShowDebugPanel}
        micStatus={micStatus}
        recognizedText={recognizedText}
        avatarSpeaking={avatarSpeaking}
      />
    </LiveKitRoom>
  );
}

const RoomView = ({
  onClose,
  loading,
  showDebugPanel,
  setShowDebugPanel,
  micStatus,
  recognizedText,
  avatarSpeaking,
}: {
  onClose: () => void;
  loading: boolean;
  showDebugPanel: boolean;
  setShowDebugPanel: (show: boolean) => void;
  micStatus: 'ON' | 'OFF' | 'PAUSED' | 'COOLDOWN';
  recognizedText: string;
  avatarSpeaking: boolean;
}) => {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });

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
      
      {/* Simple Debug Panel */}
      {showDebugPanel && (
        <View style={styles.debugPanel}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>🎤 Debug</Text>
            <TouchableOpacity onPress={() => setShowDebugPanel(false)}>
              <Text style={styles.debugCloseButton}>✕</Text>
            </TouchableOpacity>
          </View>
          
          {/* Simple Status */}
          <View style={styles.simpleStatusRow}>
            <View style={[styles.simpleStatus, micStatus === 'ON' ? styles.statusOn : styles.statusOff]}>
              <Text style={styles.simpleStatusText}>
                MIC: {micStatus === 'ON' ? 'ON' : 'OFF'}
              </Text>
            </View>
            
            <View style={[styles.simpleStatus, avatarSpeaking ? styles.statusOn : styles.statusOff]}>
              <Text style={styles.simpleStatusText}>
                AVATAR: {avatarSpeaking ? 'SPEAKING' : 'SILENT'}
              </Text>
            </View>
          </View>
          
          {/* Last Recognized Text */}
          {recognizedText && (
            <View style={styles.simpleRecognizedContainer}>
              <Text style={styles.simpleRecognizedText}>
                "{recognizedText}"
              </Text>
            </View>
          )}
        </View>
      )}
      
      {/* Debug Toggle Button */}
      <TouchableOpacity
        style={styles.debugToggleButton}
        onPress={() => setShowDebugPanel(!showDebugPanel)}
      >
        <Text style={styles.debugToggleText}>
          {showDebugPanel ? 'Hide Debug' : 'Show Debug'}
        </Text>
      </TouchableOpacity>
      
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
  // Simple Debug Panel Styles
  debugPanel: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 10,
    padding: 15,
    zIndex: 1000,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  debugTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  debugCloseButton: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  simpleStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  simpleStatus: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    minWidth: 100,
    alignItems: 'center',
  },
  statusOn: {
    backgroundColor: 'rgba(76, 175, 80, 0.8)', // Green
  },
  statusOff: {
    backgroundColor: 'rgba(244, 67, 54, 0.8)', // Red
  },
  simpleStatusText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  simpleRecognizedContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    padding: 8,
    borderRadius: 5,
  },
  simpleRecognizedText: {
    color: '#FFF',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  debugToggleButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(166, 123, 91, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    zIndex: 1001,
  },
  debugToggleText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
