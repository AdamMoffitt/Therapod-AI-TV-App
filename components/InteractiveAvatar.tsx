import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  BackHandler,
  Alert,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  isTrackReference
} from "@livekit/react-native";
import { registerGlobals } from '@livekit/react-native';
import { Track } from "livekit-client";
import { therapodWebSocketService, fetchWelcomeMessage } from '../services/TherapodWebsocketService';
import { heyGenAvatarStreamingService } from '../services/HeyGenAvatarStreamingService';

registerGlobals();

const API_CONFIG = {
  apiKey: "NDNmMDRlZDRlYjI3NDVjNjk3ODU3ZDVmZGMyNjk1OGItMTc1NDE0MjEyMQ==",
  serverUrl: "https://api.heygen.com",
};

// === RoomView Component ===
const RoomView = ({
  onSessionEnd,
  loading,
  isRecording,
  isListening,
  recognizedText,
  allRecognizedText,
  micStatus,
}: {
  onSessionEnd: () => void;
  loading: boolean;
  isRecording: boolean;
  isListening: boolean;
  recognizedText: string;
  allRecognizedText: string[];
  micStatus: { status: string; color: string; text: string };
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
      {recognizedText && (
        <View style={styles.bottomSpeechContainer}>
          <Text style={styles.bottomSpeechText}>
            {recognizedText}
          </Text>
        </View>
      )}
      <View style={styles.statusContainer}>
        <View style={[styles.microphoneStatusButton, { backgroundColor: micStatus.color }]}>
          <Text style={styles.microphoneStatusText}>
            🎤 {micStatus.text}
          </Text>
        </View>
      </View>
      {isRecording && (
        <View style={styles.listeningIndicatorContainer}>
          <Text style={styles.listeningIndicatorText}>Listening</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

// === Main InteractiveAvatar Component ===
export default function InteractiveAvatar({ onSessionEnd, wsUrl, token, loading = false, avatarSessionData, therapodSessionData, countdown }: any) {
  const [isRecording, setIsRecording] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [allRecognizedText, setAllRecognizedText] = useState<string[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [isSpeechRecognitionDisabled, setIsSpeechRecognitionDisabled] = useState(false);
  const [isProcessingUserMessage, setIsProcessingUserMessage] = useState(false);
  const [avatarSessionId, setAvatarSessionId] = useState<string>('');
  const [avatarSessionToken, setAvatarSessionToken] = useState<string>('');
  const [avatarConnected, setAvatarConnected] = useState(false);
  const [avatarWsUrl, setAvatarWsUrl] = useState<string>('');
  const [avatarAccessToken, setAvatarAccessToken] = useState<string>('');
  const [avatarLivekitUrl, setAvatarLivekitUrl] = useState<string>('');

  useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (onSessionEnd) {
        Alert.alert("End Session", "Do you want to end this session?", [
          { text: "Cancel", style: "cancel" },
          { text: "End Session", onPress: onSessionEnd, style: "destructive" },
        ]);
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [onSessionEnd]);

  useEffect(() => {
    let isMounted = true;

    const initializeSession = async () => {
      if (!avatarSessionData) return;
      try {
        setAvatarSessionId(avatarSessionData.avatarSessionId);
        setAvatarSessionToken(avatarSessionData.avatarSessionToken);
        setAvatarWsUrl(avatarSessionData.avatarWsUrl);
        setAvatarAccessToken(avatarSessionData.avatarAccessToken);
        setAvatarLivekitUrl(avatarSessionData.avatarLivekitUrl);
        setAvatarConnected(true);

        // Set up event handlers for HeyGen WebSocket events
        heyGenAvatarStreamingService.setEventHandlers({
          onAvatarSpeaking: () => {
            setIsAvatarSpeaking(true);
            stopRecording();
          },
          onAvatarFinished: () => {
            setIsAvatarSpeaking(false);
            onAvatarFinishedSpeaking();
            startRecording();
          },
          onTaskCompleted: () => {
            setIsAvatarSpeaking(false);
            onAvatarFinishedSpeaking();
            startRecording();
          }
        });

        // Preconnect to Therapod WebSocket service to reduce first message latency
        therapodWebSocketService.preconnect();

        // Fetch and speak welcome message
        const welcomeMessage = await fetchWelcomeMessage();
        console.log("🔊 Speaking welcome message:", welcomeMessage);

        // Speak welcome message with delay to help synchronize audio and video
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Make the avatar speak the welcome message
        if (avatarSessionData.avatarSessionId && avatarSessionData.avatarSessionToken) {
          try {
            const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${avatarSessionData.avatarSessionToken}`,
              },
              body: JSON.stringify({
                session_id: avatarSessionData.avatarSessionId,
                text: welcomeMessage,
                task_type: "talk",
              }),
            });
            
            // Set avatar as speaking to prevent microphone from starting
            setIsAvatarSpeaking(true);
            
            // Start recording will be triggered by the HeyGen WebSocket event when avatar finishes speaking
            console.log("🎤 Microphone will start after avatar finishes welcome message");
            
            // Fallback: If WebSocket events don't work, start microphone after 15 seconds
            setTimeout(() => {
              if (isMounted && isAvatarSpeaking) {
                console.log("⏰ Fallback: Starting microphone after 15 seconds (no WebSocket events received)");
                setIsAvatarSpeaking(false);
                startRecording();
              }
            }, 15000);
            
          } catch (error) {
            console.error("❌ Error making avatar speak welcome message:", error);
            // If welcome message fails, start recording anyway
            startRecording();
          }
        }

      } catch (error) {
        console.error("❌ Session init error:", error);
        startRecording();
      }
    };

    initializeSession();

    return () => {
      isMounted = false;
      const stopRecording = async () => {
        try {
          await ExpoSpeechRecognitionModule.stop();
          setIsRecording(false);
          setIsListening(false);
        } catch (error) {
          console.error('❌ Error stopping recording:', error);
        }
      };
      stopRecording();
    };
  }, [avatarSessionData]);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results?.[0]?.transcript;
    const confidence = event.results?.[0]?.confidence || 0;
    if (transcript) {
      setRecognizedText(transcript);
      if (event.isFinal || confidence !== 0) {
        setAllRecognizedText(prev => [...prev, transcript]);
        setRecognizedText('');
        if (confidence !== 0) {
          setMessages(prev => [...prev, { role: 'user', content: transcript }]);
        }
      }
    }
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (event.value !== undefined) {
      setAudioLevel(event.value);
    }
  });

  useSpeechRecognitionEvent("audiostart", () => {
    console.log('🎤 Starting to listen - user started speaking');
    setIsListening(true);
    setRecognizedText(''); // Clear any previous recognition text
  });
  
  useSpeechRecognitionEvent("audioend", () => {
    console.log('🔇 User stopped speaking (audio ended)');
    setIsListening(false);
    
    // Process collected messages when user stops speaking (after 2-second silence)
    if (messages.length > 0) {
      console.log('📤 Processing collected messages after audio end:', messages);
      const combinedMessage = messages.map(m => m.content).join(' ');
      processUserMessage(combinedMessage);
      setMessages([]); // Clear messages after processing
    }
  });
  useSpeechRecognitionEvent("start", () => {
    setIsRecording(true);
    setIsListening(true);
  });
  useSpeechRecognitionEvent("end", () => {
    setIsRecording(false);
    setIsListening(false);
  });
  useSpeechRecognitionEvent("error", (event) => {
    console.error("SPEECH ERROR:", event);
  });

  const startRecording = async () => {
    try {
      console.log('🎤 Starting microphone recording...');
      
      // Request permissions
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        console.error('❌ Microphone permission denied');
        return;
      }

      // Check if recognition is available
      const isAvailable = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!isAvailable) {
        console.error('❌ Speech recognition not available');
        return;
      }

      // Start recording
      const config = {
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        partialResults: false,
        speechTimeout: 2000,
      };

      await ExpoSpeechRecognitionModule.start(config);
      setIsRecording(true);
      setIsListening(true);
      console.log('✅ Microphone recording started');
    } catch (error) {
      console.error('❌ Error starting recording:', error);
    }
  };

  const stopRecording = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
      console.log('🛑 Speech recognition stopped');
    } catch (error) {
      console.error('❌ Error stopping speech recognition:', error);
    }
  };

  // Helper functions
  const getTherapodSessionId = () => {
    return therapodSessionData?.sessionId || 'therapod-session-' + Date.now();
  };

  const getUserId = () => {
    return therapodSessionData?.userId || 'user-' + Date.now();
  };

  const getTherapistName = () => {
    return therapodSessionData?.therapistName || 'AI Therapist';
  };

  const getTherapistId = () => {
    return 'therapist-1';
  };

  const getTherapodId = () => {
    return therapodSessionData?.podId || 'therapod-1';
  };

  const onUserSpoke = () => {
    console.log('👤 User spoke - resetting timers');
  };

  const onAvatarFinishedSpeaking = () => {
    console.log('✅ Avatar finished speaking');
    setIsAvatarSpeaking(false);
    // Resume recording when avatar finishes speaking
    startRecording();
  };

  // Function to send user message to our API and get response
  const processUserMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim()) return;

      // Prevent multiple simultaneous API calls
      if (isProcessingUserMessage || isAvatarSpeaking || isSpeechRecognitionDisabled) {
        console.log(
          "⏳ Already processing message, avatar speaking, or speech recognition disabled, skipping:",
          userMessage
        );
        return;
      }

      // Clear timers when user speaks
      onUserSpoke();

      try {
        setIsProcessingUserMessage(true);
        setCurrentTranscription(`Processing: "${userMessage}"`);
        console.log("🔍 PROCESSING USER MESSAGE:", userMessage);

        console.log("📤 SENDING REQUEST TO FARGATE SERVICE VIA CLIENT WEBSOCKET");

        // Get therapod sessionId from session data
        const currentTherapodSessionId = getTherapodSessionId();
        console.log("🔍 Therapod SessionId:", currentTherapodSessionId);

        // Send via client-side WebSocket service
        try {
          const payload = {
            messages: [{ role: "user" as const, content: userMessage }],
            user_id: getUserId(),
            therapist_name: getTherapistName(),
            therapist_id: getTherapistId(),
            pod_id: getTherapodId(),
            session_id: currentTherapodSessionId,
          };
          
          console.log("🌐 Sending via client WebSocket with payload:", payload);
          
          // Use the client WebSocket service
          const responseText = await therapodWebSocketService.sendMessage(payload);

          console.log("📥 RECEIVED RESPONSE FROM FARGATE SERVICE VIA CLIENT WEBSOCKET");
          console.log("📥 RESPONSE TEXT:", responseText);

          // Process the streaming response from Fargate
          let fullResponse = "";

          try {
            // Split response into lines (each line is a JSON chunk)
            const lines = responseText
              .split("\n")
              .filter((line: string) => line.trim() !== "");
            console.log("📊 Processing", lines.length, "response chunks");

            // Process each chunk and accumulate content
            for (const line of lines) {
              try {
                const chunk = JSON.parse(line);
                if (chunk.content) {
                  fullResponse += chunk.content;
                }
              } catch (chunkError) {
                console.warn("⚠️ Failed to parse chunk:", line, chunkError);
              }
            }

            console.log("✅ FINAL ASSEMBLED RESPONSE FROM FARGATE:", fullResponse);

            // Ensure we have a complete sentence
            if (fullResponse.trim() && !fullResponse.trim().match(/[.!?]$/)) {
              fullResponse = fullResponse.trim() + ".";
            }

            // If no content was extracted, try fallback parsing
            if (!fullResponse.trim()) {
              try {
                const parsedResponse = JSON.parse(responseText);
                if (parsedResponse.content) {
                  fullResponse = parsedResponse.content;
                } else {
                  fullResponse = responseText.trim();
                }
              } catch (fallbackError) {
                fullResponse = responseText.trim();
              }
            }
          } catch (parseError) {
            console.log("⚠️ Error processing streaming response:", parseError);
            fullResponse = responseText.trim();
          }

          if (!fullResponse.trim()) {
            console.error("❌ EMPTY RESPONSE FROM FARGATE SERVICE!");
            return;
          }

          // Sanitize the response
          let sanitizedResponse = fullResponse
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .replace(/\\n/g, " ")
            .replace(/\\t/g, " ")
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();

          // Truncate extremely long responses
          if (sanitizedResponse.length > 2000) {
            sanitizedResponse = sanitizedResponse.substring(0, 1997) + "...";
          }

          console.log("🔊 MAKING AVATAR SPEAK FARGATE RESPONSE:", sanitizedResponse);
          setCurrentTranscription(
            `AI: "${sanitizedResponse.substring(0, 100)}${sanitizedResponse.length > 100 ? "..." : ""}"`
          );

          // Make the avatar speak using HeyGen avatar session
          if (avatarSessionId && avatarSessionToken && avatarConnected) {
            console.log("🔊 Making avatar speak via HeyGen:", sanitizedResponse);
            setIsAvatarSpeaking(true);
            
            // Pause speech recognition while avatar is speaking
            console.log("🛑 Pausing speech recognition during avatar speech");
            await stopRecording();
            
            try {
              const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${avatarSessionToken}`,
                },
                body: JSON.stringify({
                  session_id: avatarSessionId,
                  text: sanitizedResponse,
                  task_type: "talk",
                }),
              });
              
              const data = await response.json();
              console.log("Avatar speaking response:", data);
            
            } catch (error) {
              console.error("❌ Error making avatar speak:", error);
              setIsAvatarSpeaking(false);
            }
          } else {
            console.log("🔊 HeyGen session not ready, simulating avatar speech");
            setIsAvatarSpeaking(true);
            setTimeout(() => {
              setIsAvatarSpeaking(false);
              onAvatarFinishedSpeaking();
            }, 3000);
          }

        } catch (error) {
          console.error("❌ Error in processUserMessage:", error);
        } finally {
          setIsProcessingUserMessage(false);
          setCurrentTranscription("");
        }
      } catch (error) {
        console.error("❌ Error in processUserMessage:", error);
      }
    },
    [messages, isProcessingUserMessage, isAvatarSpeaking, isSpeechRecognitionDisabled, avatarSessionId, avatarSessionToken, avatarConnected]
  );

  const micStatus = (() => {
    if (isProcessingUserMessage) return { status: 'PROCESSING_USER_MESSAGE', color: '#D4AF37', text: 'Processing...' };
    if (isAvatarSpeaking) return { status: 'AVATAR_SPEAKING', color: '#B8860B', text: 'AI Speaking' };
    if (isRecording && isListening) return { status: 'LISTENING_AND_RECORDING', color: '#FFD700', text: 'Listening & Recording' };
    if (isRecording) return { status: 'RECORDING', color: '#F4C430', text: 'Recording' };
    return { status: 'OFF', color: '#D3D3D3', text: 'Mic Off' };
  })();

  if (!avatarLivekitUrl || !avatarAccessToken) {
    return (
      <SafeAreaView style={styles.container}>
        {recognizedText && <Text style={styles.bottomSpeechText}>{recognizedText}</Text>}
      </SafeAreaView>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={avatarLivekitUrl}
      token={avatarAccessToken}
      connect={true}
      options={{ adaptiveStream: { pixelDensity: "screen" } }}
      audio={false}
      video={false}
    >
      <RoomView
        onSessionEnd={onSessionEnd || (() => {})}
        loading={loading}
        isRecording={isRecording}
        isListening={isListening}
        recognizedText={recognizedText}
        allRecognizedText={allRecognizedText}
        micStatus={micStatus}
      />
    </LiveKitRoom>
  );
}

// === Styles ===
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFF8F0" },
  videoContainer: { flex: 1, position: "relative" },
  videoView: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  bottomSpeechContainer: {
    position: "absolute", bottom: 100, left: 20, right: 20,
    maxHeight: 80,
  },
  bottomSpeechText: {
    fontSize: 16,
    color: "#333333",
    fontWeight: "500",
    textAlign: "center",
    textShadowColor: "rgba(255, 255, 255, 0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statusContainer: {
    position: "absolute", top: 50, left: 20, zIndex: 1000,
  },
  microphoneStatusButton: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, elevation: 3,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4,
  },
  microphoneStatusText: {
    color: "#FFF", fontSize: 14,
    fontWeight: "600", textAlign: "center",
  },
  listeningIndicatorContainer: {
    position: "absolute", bottom: 50, left: 0, right: 0,
    alignItems: "center", zIndex: 1000,
  },
  listeningIndicatorText: {
    fontSize: 14, color: "#A67B5B", fontStyle: "italic", fontWeight: "400",
  },
});
