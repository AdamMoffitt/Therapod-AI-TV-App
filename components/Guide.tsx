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
  therapistId?: string | null;
  selectedPod?: string | null;
}

export default function Guide({ onSessionEnd, userId, therapistName, therapistId, selectedPod }: GuideProps) {
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

  // Inactivity detection state
  const [lastUserActivity, setLastUserActivity] = useState<number>(Date.now());
  const [inactivityCheckSent, setInactivityCheckSent] = useState<boolean>(false);
  const [finalWarningSent, setFinalWarningSent] = useState<boolean>(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const finalWarningTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper functions to get user data
  const getUserId = () => {
    return userId || null;
  };

  const getTherapistId = () => {
    return therapistId || "N6j3amuwz99kyJdOma4b";
  };

  const getSessionId = () => {
    return sessionId || null;
  };

  // Function to reset inactivity timers when user speaks
  const resetInactivityTimers = () => {
    console.log('🔄 User activity detected - resetting inactivity timers');
    setLastUserActivity(Date.now());
    setInactivityCheckSent(false);
    setFinalWarningSent(false);
    
    // Clear existing timers
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (finalWarningTimerRef.current) {
      clearTimeout(finalWarningTimerRef.current);
      finalWarningTimerRef.current = null;
    }
    
    // Start new inactivity timer
    startInactivityTimer();
  };

  // Function to start inactivity timer
  const startInactivityTimer = () => {
    console.log('⏰ Starting inactivity timer (30 seconds)');
    inactivityTimerRef.current = setTimeout(() => {
      if (!inactivityCheckSent) {
        sendInactivityCheck();
      }
    }, 30000); // 30 seconds
  };

  // Function to send first inactivity check
  const sendInactivityCheck = async () => {
    try {
      console.log('🤔 User inactive for 30 seconds - sending check-in message');
      setInactivityCheckSent(true);
      
      const checkInMessage = "Hey there, haven't heard from you in a while, are you still there?";
      
      // Make HeyGen avatar speak the check-in message
      await makeAvatarSpeak(checkInMessage);
      
      // Start final warning timer
      finalWarningTimerRef.current = setTimeout(() => {
        if (!finalWarningSent) {
          sendFinalWarning();
        }
      }, 30000); // Another 30 seconds
      
    } catch (error) {
      console.error("Error sending inactivity check:", error);
    }
  };

  // Function to send final warning and end session
  const sendFinalWarning = async () => {
    try {
      console.log('⚠️ User inactive for 60 seconds - sending final warning and ending session');
      setFinalWarningSent(true);
      
      const finalWarningMessage = "I haven't heard from you in a while, going to end the session now. Look forward to talking again soon.";
      
      // Make HeyGen avatar speak the final warning
      await makeAvatarSpeak(finalWarningMessage);
      
      // Wait for final warning to finish, then send ending message
      setTimeout(async () => {
        try {
          console.log('🎬 Sending personalized ending message...');
          
          // Fetch personalized ending message from API
          const endingMessage = await fetchEndingMessage();
          console.log('🎤 Sending ending message:', endingMessage);
          
          // Make HeyGen avatar speak the ending message
          await makeAvatarSpeak(endingMessage);
          
          // End session after ending message finishes (allow more time for longer message)
          setTimeout(() => {
            console.log('🛑 Ending session due to user inactivity - ending message completed');
            console.log('🛑 Calling onSessionEnd callback...');
            if (onSessionEnd) {
              console.log('✅ onSessionEnd callback exists, calling it...');
              onSessionEnd();
            } else {
              console.error('❌ onSessionEnd callback is null or undefined');
            }
          }, 8000); // Increased delay to allow for longer ending messages
          
        } catch (error) {
          console.error("Error sending ending message:", error);
          // End session immediately if ending message fails
          console.log('🛑 Ending session due to ending message error...');
          if (onSessionEnd) {
            console.log('✅ onSessionEnd callback exists, calling it...');
            onSessionEnd();
          } else {
            console.error('❌ onSessionEnd callback is null or undefined');
          }
        }
      }, 5000); // Wait 5 seconds for final warning to finish
      
    } catch (error) {
      console.error("Error sending final warning:", error);
      // End session immediately if error
      console.log('🛑 Ending session due to final warning error...');
      if (onSessionEnd) {
        console.log('✅ onSessionEnd callback exists, calling it...');
        onSessionEnd();
      } else {
        console.error('❌ onSessionEnd callback is null or undefined');
      }
    }
  };

  // Cleanup inactivity timers on unmount
  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (finalWarningTimerRef.current) {
        clearTimeout(finalWarningTimerRef.current);
      }
    };
  }, []);

  const fetchWelcomeMessage = async () => {
    try {
      const userId = getUserId();
      const therapistId = getTherapistId();
      const sessionId = getSessionId();
      
      // Validate sessionId before making API call
      if (!sessionId) {
        console.error('❌ Cannot fetch welcome message: sessionId is null or undefined');
        throw new Error('Session ID is required for welcome message API call');
      }
      
      console.log('🔍 Fetching welcome message for user:', userId, 'therapist:', therapistId, 'session:', sessionId);
      
      const requestBody = { 
        user_id: userId,
        therapist_id: therapistId,
        session_id: sessionId
      };
      
      console.log('📤 Welcome message request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch('https://api.therapodai.com/welcome-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      console.log('📥 Welcome message API response:', { 
        status: response.status, 
        ok: response.ok,
        statusText: response.statusText
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Welcome message API error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log('📥 Welcome message API data received:', data);
      
      // Check if welcome_message exists in the response
      if (data && data.welcome_message) {
        console.log('✅ Welcome message received:', data.welcome_message);
        return data.welcome_message;
      } else if (data && data.message) {
        // Alternative field name
        console.log('✅ Welcome message received (from message field):', data.message);
        return data.message;
      } else if (data && typeof data === 'string') {
        // Direct string response
        console.log('✅ Welcome message received (direct string):', data);
        return data;
      } else {
        console.error('❌ Welcome message API returned unexpected data structure:', data);
        throw new Error('Invalid response structure from welcome message API');
      }
    } catch (error) {
      console.error('❌ Error fetching welcome message:', error);
      const fallbackMessage = therapistName 
        ? `Hello! I'm ${therapistName}, your AI therapist. I'm here for our therapy session. How are you feeling today?`
        : `Hello! I'm your AI therapist. I'm here for our therapy session. How are you feeling today?`;
      console.log('📝 Using fallback welcome message:', fallbackMessage);
      return fallbackMessage;
    }
  };

  const fetchEndingMessage = async () => {
    try {
      const userId = getUserId();
      const therapistId = getTherapistId();
      const sessionId = getSessionId();
      
      // Validate sessionId before making API call
      if (!sessionId) {
        console.error('❌ Cannot fetch ending message: sessionId is null or undefined');
        throw new Error('Session ID is required for ending message API call');
      }
      
      console.log('🔍 Fetching ending message for user:', userId, 'therapist:', therapistId, 'session:', sessionId);
      
      const requestBody = { 
        user_id: userId,
        therapist_id: therapistId,
        session_id: sessionId
      };
      
      console.log('📤 Ending message request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch('https://api.therapodai.com/ending-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      console.log('📥 Ending message API response:', { 
        status: response.status, 
        ok: response.ok,
        statusText: response.statusText
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Ending message API error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log('📥 Ending message API data received:', data);
      
      // Check if ending_message exists in the response
      if (data && data.ending_message) {
        console.log('✅ Ending message received:', data.ending_message);
        return data.ending_message;
      } else if (data && data.message) {
        // Alternative field name
        console.log('✅ Ending message received (from message field):', data.message);
        return data.message;
      } else if (data && typeof data === 'string') {
        // Direct string response
        console.log('✅ Ending message received (direct string):', data);
        return data;
      } else {
        console.error('❌ Ending message API returned unexpected data structure:', data);
        throw new Error('Invalid response structure from ending message API');
      }
    } catch (error) {
      console.error('❌ Error fetching ending message:', error);
      const fallbackMessage = "Thank you for sharing your thoughts with me today. I hope our conversation was helpful. Remember to take care of yourself, and I'll be here whenever you need to talk again. Take care and have a wonderful day!";
      console.log('📝 Using fallback ending message:', fallbackMessage);
      return fallbackMessage;
    }
  };

  // Conversation history for the chat API
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);

  // Function to send message to custom chat API and get AI response
  const sendMessageToChatAPI = async (userMessage: string): Promise<string> => {
    try {
      const userId = getUserId();
      const therapistId = getTherapistId();
      const sessionId = getSessionId();
      
      // Validate sessionId before making API call
      if (!sessionId) {
        console.error('❌ Cannot send message: sessionId is null or undefined');
        throw new Error('Session ID is required for API calls');
      }
      
      // Add user message to conversation history
      const updatedMessages = [...messages, { role: 'user' as const, content: userMessage }];
      setMessages(updatedMessages);
      
      console.log('🌐 Calling custom chat API with payload:', { 
        messageCount: updatedMessages.length,
        userMessage: userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : ''),
        userId,
        therapistId,
        sessionId,
        selectedPod
      });
      
      const requestBody = { 
        messages: updatedMessages, 
        user_id: userId,
        therapist_name: therapistName || "Claire",
        therapist_id: therapistId,
        pod_id: selectedPod || null,
        session_id: sessionId
      };
      
      console.log('📤 Full request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      console.log('📥 RECEIVED RESPONSE FROM CHAT API', { 
        status: response.status, 
        ok: response.ok,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length')
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error Response:', errorText);
        throw new Error(`Failed to get response from API: ${response.status} - ${response.statusText} - ${errorText}`);
      }
      
      // Get the full response text
      const responseText = await response.text();
      console.log('📝 RESPONSE FROM CHAT API (RAW TEXT LENGTH):', responseText.length);
      console.log('📝 RESPONSE FROM CHAT API (RAW TEXT):', responseText);
      
      // Process the streaming response (handling word-by-word chunks)
      let fullResponse = '';
      
      try {
        // Split response into lines (each line is a JSON chunk)
        const lines = responseText.split('\n').filter(line => line.trim() !== '');
        console.log('📊 Processing', lines.length, 'response chunks');
        
        // Process each chunk and accumulate content
        for (const line of lines) {
          try {
            const chunk = JSON.parse(line);
            console.log('📊 Processing chunk:', chunk);
            
            if (chunk.content) {
              fullResponse += chunk.content;
              console.log('✅ Added content:', chunk.content, 'Total so far:', fullResponse);
            }
          } catch (chunkError) {
            console.warn('⚠️ Failed to parse chunk:', line, chunkError);
          }
        }
        
        console.log('✅ FINAL ASSEMBLED RESPONSE FROM CHAT API:', fullResponse);
        console.log('✅ FINAL RESPONSE LENGTH:', fullResponse.length);
        
        // Ensure we have a complete sentence (ends with punctuation)
        if (fullResponse.trim() && !fullResponse.trim().match(/[.!?]$/)) {
          console.log('⚠️ Response doesn\'t end with punctuation, adding period');
          fullResponse = fullResponse.trim() + ".";
        }
        
        // If no content was extracted, try fallback parsing
        if (!fullResponse.trim()) {
          console.log('⚠️ No content extracted from chunks, trying fallback parsing');
          try {
            const parsedResponse = JSON.parse(responseText);
            if (parsedResponse.content) {
              fullResponse = parsedResponse.content;
            } else {
              fullResponse = responseText.trim();
            }
          } catch (fallbackError) {
            console.log('⚠️ Fallback parsing failed, using raw text');
            fullResponse = responseText.trim();
          }
        }
      } catch (parseError) {
        console.log('⚠️ Error processing streaming response:', parseError);
        fullResponse = responseText.trim();
        console.log('✅ USING RAW TEXT RESPONSE:', fullResponse);
        console.log('✅ RAW TEXT RESPONSE LENGTH:', fullResponse.length);
      }
      
      if (!fullResponse.trim()) {
        throw new Error('Empty response from chat API');
      }
      
      // Add AI response to conversation history
      setMessages([...updatedMessages, { role: 'assistant' as const, content: fullResponse }]);
      
      return fullResponse;
      
    } catch (error) {
      console.error('❌ Error calling chat API:', error);
      throw error;
    }
  };

  // Function to make HeyGen avatar speak text (without AI processing)
  const makeAvatarSpeak = async (text: string) => {
    try {
      // Safety check for undefined or null text
      if (!text || typeof text !== 'string') {
        console.error('❌ Invalid text provided to makeAvatarSpeak:', text);
        throw new Error('Invalid text provided to makeAvatarSpeak');
      }
      
      console.log('🎤 Making HeyGen avatar speak:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
      
      // Sanitize the response to make it more avatar-friendly
      let sanitizedText = text
        // Replace any escaped quotes or backslashes
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        // Remove any JSON formatting artifacts
        .replace(/\\n/g, ' ')
        .replace(/\\t/g, ' ')
        // Remove any potential HTML tags
        .replace(/<[^>]*>/g, '')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
        
      // Truncate extremely long responses to prevent memory issues
      if (sanitizedText.length > 2000) {
        console.log('⚠️ Response too long, truncating to 2000 chars');
        sanitizedText = sanitizedText.substring(0, 1997) + "...";
      }
      
      console.log('🔊 SANITIZED TEXT FOR AVATAR:', sanitizedText.substring(0, 50) + (sanitizedText.length > 50 ? "..." : ""));
      console.log('🔊 FULL SANITIZED TEXT LENGTH:', sanitizedText.length);
      
      // Send to HeyGen for avatar speaking only (no AI processing)
      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          text: sanitizedText,
          task_type: "talk", // Use talk mode to make avatar speak without AI processing
        }),
      });
      
      const data = await response.json();
      console.log('✅ Avatar speaking task sent to HeyGen:', data);
      
      // Set avatar speaking state
      setAvatarSpeaking(true);
      setMicPausedForAvatar(true);
      setSpeaking(true);
      
    } catch (error) {
      console.error('❌ Error making avatar speak:', error);
      setAvatarSpeaking(false);
      setSpeaking(false);
      setMicPausedForAvatar(false);
      throw error;
    }
  };

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

    // Set up periodic microphone health check for always-on mode
    const microphoneHealthCheck = setInterval(() => {
      if (conversationMode === 'always_on' && voiceModeEnabled && !avatarSpeaking && !micPausedForAvatar && !isRecording) {
        console.log('🔍 Health check: Ensuring microphone is active...');
        startAlwaysOnListening();
      }
    }, Platform.OS === 'android' && Platform.isTV ? 15000 : 10000); // 15 seconds for TV, 10 for mobile
    
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
          setSpeaking(false);
          
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
    resetInactivityTimers(); // Reset timers when speech recognition starts
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
    
    // CRITICAL: Don't restart if avatar is speaking to prevent echo
    if (avatarSpeaking || micPausedForAvatar) {
      console.log('🚫 ECHO PREVENTION: Not restarting while avatar is speaking');
      return;
    }
    
    // Always restart for always-on mode unless avatar is speaking
    if (conversationMode === 'always_on' && isAlwaysListening && !avatarSpeaking && !micPausedForAvatar && voiceModeEnabled) {
      console.log('🔄 ALWAYS-ON: Restarting microphone immediately...');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar && conversationMode === 'always_on') {
          console.log('🎤 ALWAYS-ON: Starting new listening session...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping restart - avatar speaking or mic paused');
        }
      }, 100); // Very short delay
    }
    // In continuous mode, restart listening after a brief pause if not speaking
    else if (conversationMode === 'continuous' && !speaking && voiceModeEnabled) {
      console.log('⏰ Scheduling restart in 1 second...');
      setTimeout(() => {
        if (!speaking) {
          console.log('🔄 Auto-restarting continuous listening...');
          startContinuousListening();
        } else {
          console.log('🚫 Skipping restart - AI is speaking');
        }
      }, 1000);
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
    
    // In always-on mode, try to restart after error if avatar not speaking
    if (conversationMode === 'always_on' && isAlwaysListening && !avatarSpeaking && voiceModeEnabled) {
      console.log('⏰ ALWAYS-ON: Scheduling error recovery restart in 500ms...');
      setTimeout(() => {
        if (!avatarSpeaking && !micPausedForAvatar && isAlwaysListening && conversationMode === 'always_on') {
          console.log('🔄 ALWAYS-ON: Attempting error recovery restart...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping error recovery - avatar is speaking');
        }
      }, 500);
    }
    // In continuous mode, try to restart after error
    else if (conversationMode === 'continuous' && voiceModeEnabled) {
      console.log('⏰ Scheduling error recovery restart in 2 seconds...');
      setTimeout(() => {
        if (!speaking) {
          console.log('🔄 Attempting error recovery restart...');
          startContinuousListening();
        } else {
          console.log('🚫 Skipping error recovery - AI is speaking');
        }
      }, 2000);
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    console.log('🗣️ SPEECH RESULT RECEIVED:');
    console.log(`   Results count: ${event.results?.length || 0}`);
    console.log(`   Is Final: ${event.isFinal}`);
    
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
      
      // Echo detection: check for common avatar speech patterns (less aggressive)
      if (echoPreventionEnabled && avatarSpeaking) {
        const lowerText = transcribedText.toLowerCase();
        const isLikelyEcho = (
          (lowerText.includes('hello') && lowerText.includes('therapist')) ||
          (lowerText.includes('how are you feeling') && lowerText.includes('today')) ||
          (lowerText.includes('therapy session') && lowerText.includes('i\'m here')) ||
          (confidence && confidence < 0.2) // Very low confidence might indicate echo
        );
        
        if (isLikelyEcho) {
          console.log('🚫 ECHO DETECTION: Likely avatar speech detected, ignoring');
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
          resetInactivityTimers(); // Reset inactivity timers when user speaks
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
      
      // Validate that we have a valid sessionId from Firebase
      const firebaseSessionId = getSessionId();
      console.log('🔍 Checking Firebase session ID:', firebaseSessionId);
      
      if (!firebaseSessionId) {
        console.error('❌ Cannot start session: Firebase sessionId is null or undefined');
        console.error('❌ Session requires a valid sessionId from Firebase for backend tracking');
        setLoading(false);
        // Call onSessionEnd to return to meditation view
        if (onSessionEnd) {
          console.log('🔄 Returning to meditation view due to missing sessionId');
          onSessionEnd();
        }
        return;
      }
      
      console.log('✅ Firebase sessionId is valid, proceeding with session creation');
      
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
              console.log('🗣️ Avatar started speaking - pausing microphone');
              setAvatarSpeaking(true);
              setMicPausedForAvatar(true);
              setAvatarSpeakingStartTime(Date.now());
              
              // Stop speech recognition immediately if echo prevention is enabled
              if (echoPreventionEnabled && isRecording) {
                console.log('🛑 Stopping speech recognition due to avatar speaking');
                ExpoSpeechRecognitionModule.stop();
                setIsRecording(false);
                setIsListening(false);
              }
            }
            
            // Handle avatar finished speaking events
            if (data.type === 'avatar_finished' || data.type === 'speech_end' || data.event === 'avatar_finished') {
              console.log('✅ Avatar finished speaking - resuming microphone');
              setAvatarSpeaking(false);
              setMicPausedForAvatar(false);
              setAvatarSpeakingStartTime(null);
              
              // Resume listening after a delay to prevent echo
              if (echoPreventionEnabled) {
                setTimeout(() => {
                  if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording) {
                    console.log('🔄 Resuming listening after avatar speech');
                    startAlwaysOnListening();
                  }
                }, 1000);
              }
            }
            
            // Handle task completion events
            if (data.type === 'task_completed' || data.event === 'task_completed') {
              console.log('✅ Task completed - avatar should be finished speaking');
              setAvatarSpeaking(false);
              setMicPausedForAvatar(false);
              setSpeaking(false);
              
              // Resume listening after a delay
              if (echoPreventionEnabled) {
                setTimeout(() => {
                  if (conversationMode === 'always_on' && voiceModeEnabled && !isRecording) {
                    console.log('🔄 Resuming listening after task completion');
                    startAlwaysOnListening();
                  }
                }, 1000);
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
            
            // Fetch personalized welcome message from API
            const greetingText = await fetchWelcomeMessage();
            console.log('🎤 Sending personalized welcome message:', greetingText);
            
            // Make HeyGen avatar speak the welcome message
            await makeAvatarSpeak(greetingText);
            
            // Start inactivity timer after session is initialized
            console.log('⏰ Starting inactivity monitoring...');
            startInactivityTimer();
            
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
      setAvatarSpeaking(true);
      setMicPausedForAvatar(true);
      
      // Reset inactivity timers when user sends text
      resetInactivityTimers();

      // Step 1: Send to custom chat API to get AI response
      console.log('🌐 Getting AI response from custom chat API for text input...');
      const aiResponse = await sendMessageToChatAPI(text);
      console.log('✅ AI response received:', aiResponse.substring(0, 50) + (aiResponse.length > 50 ? '...' : ''));
      
      // Step 2: Make HeyGen avatar speak the AI response
      console.log('🎤 Making HeyGen avatar speak AI response...');
      await makeAvatarSpeak(aiResponse);
      
      console.log("✅ Text message processing complete");
      setText(""); // Clear input after sending
    } catch (error) {
      console.error("Error sending text:", error);
      setAvatarSpeaking(false);
      setSpeaking(false);
      setMicPausedForAvatar(false);
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
      ExpoSpeechRecognitionModule.start(config);
      console.log('✅ TV-optimized speech recognition started');
      
      setIsRecording(true);
      setIsListening(true);
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
    
    if (conversationMode === 'always_on' && voiceModeEnabled && !avatarSpeaking && !micPausedForAvatar && !isRecording && isAlwaysListening) {
      console.log('✅ ALWAYS-ON CONDITIONS MET - STARTING LISTENING...');
      
      try {
        // Use standard recording method for reliability
        await startRecording();
        console.log('✅ Always-on listening started');
      } catch (error) {
        console.error('❌ Failed to start always-on listening:', error);
        // Try again after a short delay
        setTimeout(() => {
          if (conversationMode === 'always_on' && voiceModeEnabled) {
            console.log('🔄 Retrying always-on listening...');
            startAlwaysOnListening();
          }
        }, 1000);
      }
    } else {
      console.log('🚫 ALWAYS-ON CONDITIONS NOT MET - SKIPPING');
      if (avatarSpeaking) console.log('   Reason: Avatar is speaking');
      if (micPausedForAvatar) console.log('   Reason: Mic paused for avatar');
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
      console.log('🚀 SENDING VOICE MESSAGE TO CUSTOM CHAT API:');
      console.log(`   Message: "${transcribedText}"`);
      console.log(`   Length: ${transcribedText.length} characters`);
      console.log(`   Session ID: ${sessionId}`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);
      
      // Set speaking state and pause microphone
      console.log('🎤 Setting speaking state...');
      setSpeaking(true);
      setAvatarSpeaking(true);
      setMicPausedForAvatar(true);
      
      // Stop speech recognition immediately
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
      
      // Clear any interim results
      setRecognizedText('');

      // Step 1: Send to custom chat API to get AI response
      console.log('🌐 Getting AI response from custom chat API...');
      const aiResponse = await sendMessageToChatAPI(transcribedText);
      console.log('✅ AI response received:', aiResponse.substring(0, 50) + (aiResponse.length > 50 ? '...' : ''));
      
      // Step 2: Make HeyGen avatar speak the AI response
      console.log('🎤 Making HeyGen avatar speak AI response...');
      await makeAvatarSpeak(aiResponse);
      
      console.log('✅ Voice message processing complete');
      setText(""); // Clear any text input
      
    } catch (error) {
      console.error('❌ ERROR SENDING VOICE MESSAGE:', error);
      // Reset avatar speaking state on error
      setAvatarSpeaking(false);
      setSpeaking(false);
      setMicPausedForAvatar(false);
    }
  };

  // Function to handle when avatar finishes speaking
  const onAvatarFinishedSpeaking = () => {
    console.log('✅ AVATAR FINISHED SPEAKING');
    setAvatarSpeaking(false);
    setSpeaking(false);
    
    // Resume microphone with longer delay to ensure echo prevention
    if (conversationMode === 'always_on' && micPausedForAvatar && voiceModeEnabled) {
      console.log('🎤 ALWAYS-ON: Resuming microphone after avatar speech...');
      setMicPausedForAvatar(false);
      
      // Longer delay to ensure avatar audio completely finishes
      setTimeout(() => {
        if (!avatarSpeaking && conversationMode === 'always_on' && !isRecording) {
          console.log('🔄 ALWAYS-ON: Restarting listening after echo-safe delay...');
          startAlwaysOnListening();
        } else {
          console.log('🚫 ALWAYS-ON: Skipping restart - conditions not met');
        }
      }, 1000); // Increased delay to 1 second for better echo prevention
    } else if (conversationMode === 'continuous' && voiceModeEnabled) {
      setTimeout(() => {
        startContinuousListening();
      }, 1000);
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

      // Clean up inactivity timers
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (finalWarningTimerRef.current) {
        clearTimeout(finalWarningTimerRef.current);
        finalWarningTimerRef.current = null;
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
      setInactivityCheckSent(false);
      setFinalWarningSent(false);

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
      />
    </LiveKitRoom>
  );
}

const RoomView = ({
  onClose,
  loading,
}: {
  onClose: () => void;
  loading: boolean;
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
});
