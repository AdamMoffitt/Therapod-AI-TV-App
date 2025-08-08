import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  BackHandler,
  Alert,
  Platform,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { LiveKitRoom, VideoTrack, useTracks, isTrackReference } from "@livekit/react-native";
import { therapodWebSocketService, fetchWelcomeMessage } from '../services/TherapodWebsocketService';

const API_CONFIG = {
  apiKey: "NDNmMDRlZDRlYjI3NDVjNjk3ODU3ZDVmZGMyNjk1OGItMTc1NDE0MjEyMQ==",
  serverUrl: "https://api.heygen.com",
};

interface InteractiveAvatarProps {
  onSessionEnd?: () => void;
  wsUrl?: string;
  token?: string;
  loading?: boolean;
  userId?: string | null;
  therapistName?: string | null;
}

export default function InteractiveAvatar({ onSessionEnd, wsUrl, token, loading = false, userId, therapistName }: InteractiveAvatarProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [allRecognizedText, setAllRecognizedText] = useState<string[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  
  // Message processing state
  const [isProcessingMessage, setIsProcessingMessage] = useState(false);
  const [isProcessingFargateResponse, setIsProcessingFargateResponse] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeechRecognitionDisabled, setIsSpeechRecognitionDisabled] = useState(false);
  
  // HeyGen avatar session state
  const [avatarSessionId, setAvatarSessionId] = useState<string>('');
  const [avatarSessionToken, setAvatarSessionToken] = useState<string>('');
  const [avatarConnected, setAvatarConnected] = useState(false);
  
  // Handle back button press
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (onSessionEnd) {
          Alert.alert("End Session", "Do you want to end this session?", [
            {
              text: "Cancel",
              style: "cancel",
            },
            {
              text: "End Session",
              onPress: onSessionEnd,
              style: "destructive",
            },
          ]);
          return true; // Prevents default back action
        }
        return false;
      }
    );

    return () => backHandler.remove();
  }, [onSessionEnd]);

  // Start recording when component mounts
  useEffect(() => {
    const initializeAvatarSession = async () => {
      try {
        // Create HeyGen avatar session first
        const avatarSessionData = await createAvatarSession();
        if (avatarSessionData) {
          setAvatarSessionId(avatarSessionData.sessionId);
          setAvatarSessionToken(avatarSessionData.sessionToken);
          setAvatarConnected(true);
          console.log("✅ HeyGen avatar session initialized successfully");
          
          // Fetch and speak welcome message
          console.log("📝 Fetching welcome message from API...");
          const welcomeMessage = await fetchWelcomeMessage();
          console.log("🔊 Speaking welcome message:", welcomeMessage);

          // Speak welcome message with delay to help synchronize audio and video
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Make the avatar speak the welcome message
          if (avatarSessionData.sessionId && avatarSessionData.sessionToken) {
            try {
              const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${avatarSessionData.sessionToken}`,
                },
                body: JSON.stringify({
                  session_id: avatarSessionData.sessionId,
                  text: welcomeMessage,
                  task_type: "talk",
                }),
              });
              
              const data = await response.json();
              console.log("Welcome message avatar response:", data);
              
              // Simulate avatar speaking completion
              setTimeout(() => {
                setIsSpeaking(false);
                onAvatarFinishedSpeaking();
              }, Math.max(3000, welcomeMessage.length * 50));
              
            } catch (error) {
              console.error("❌ Error making avatar speak welcome message:", error);
            }
          }
        } else {
          console.error("❌ Failed to initialize HeyGen avatar session");
        }
      } catch (error) {
        console.error("❌ Error initializing HeyGen avatar session:", error);
      }
    };

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
          speechTimeout: 10000,
        };

        await ExpoSpeechRecognitionModule.start(config);
        setIsRecording(true);
        setIsListening(true);
        console.log('✅ Microphone recording started');
      } catch (error) {
        console.error('❌ Error starting recording:', error);
      }
    };

    // Initialize HeyGen avatar session and start recording
    initializeAvatarSession().then(() => {
      startRecording();
    });

    // Cleanup on unmount
    return () => {
      const stopRecording = async () => {
        try {
          await ExpoSpeechRecognitionModule.stop();
          setIsRecording(false);
          setIsListening(false);
          console.log('🛑 Microphone recording stopped');
        } catch (error) {
          console.error('❌ Error stopping recording:', error);
        }
      };
      stopRecording();
    };
  }, []);

  // Handle speech recognition events
  useSpeechRecognitionEvent("result", (event) => {
    console.log('🎯 SPEECH RESULT:', event);
    if (event.results && event.results.length > 0) {
      const transcript = event.results[0].transcript;
      const confidence = event.results[0].confidence || 0;
      setRecognizedText(transcript);
      
      // Add to history if it's a final result
      if (event.isFinal || confidence !== 0) {
        console.log('FINAL RESULT:', event);
        setAllRecognizedText(prev => [...prev, transcript]);
        setRecognizedText(''); // Clear current text for next input
        
        // Only process the user message if confidence is not 0 (end of sentence)
        if (confidence !== 0) {
          console.log('✅ Confidence > 0, processing user message:', confidence);
          processUserMessage(transcript);
        } else {
          console.log('❌ Confidence is 0, skipping message processing');
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
    console.log('🎙️ AUDIO CAPTURE STARTED');
    setIsListening(true);
  });

  useSpeechRecognitionEvent("audioend", () => {
    console.log('🎙️ AUDIO CAPTURE ENDED');
    setIsListening(false);
  });

  useSpeechRecognitionEvent("start", () => {
    console.log('🟢 SPEECH RECOGNITION STARTED');
    setIsRecording(true);
    setIsListening(true);
  });

  useSpeechRecognitionEvent("end", () => {
    console.log('🔴 SPEECH RECOGNITION ENDED');
    setIsRecording(false);
    setIsListening(false);
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.error('❌ SPEECH RECOGNITION ERROR:', event);
  });

  // Helper functions
  const getTherapodSessionId = () => {
    // Extract therapod session ID from URL or generate one
    return 'therapod-session-' + Date.now();
  };

  const getUserId = () => {
    return userId || 'user-' + Date.now();
  };

  const getTherapistName = () => {
    return 'AI Therapist';
  };

  const getTherapistId = () => {
    return 'therapist-1';
  };

  const getTherapodId = () => {
    return 'therapod-1';
  };

  const onUserSpoke = () => {
    // Reset any timers when user speaks
    console.log('👤 User spoke - resetting timers');
  };

  const onAvatarFinishedSpeaking = () => {
    console.log('✅ Avatar finished speaking');
    setIsSpeaking(false);
  };

  // HeyGen Session Management
  const getAvatarSessionToken = async () => {
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
      console.log("Avatar Session token obtained", data.data.token);
      return data.data.token;
    } catch (error) {
      console.error("Error getting avatar session token:", error);
      throw error;
    }
  };

  const startAvatarStreamingSession = async (
    avatarSessionId: string,
    avatarSessionToken: string
  ) => {
    try {
      console.log("Starting avatar streaming session with:", {
        avatarSessionId,
        avatarSessionToken,
      });
      const startResponse = await fetch(
        `${API_CONFIG.serverUrl}/v1/streaming.start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${avatarSessionToken}`,
          },
          body: JSON.stringify({
            session_id: avatarSessionId,
          }),
        }
      );

      const startData = await startResponse.json();
      console.log("Avatar streaming start response:", startData);

      if (startData && startData.success !== false) {
        console.log("✅ Avatar session started successfully, setting connected to true");
        return true;
      } else {
        console.error("❌ Avatar session start failed:", startData);
        return false;
      }
    } catch (error) {
      console.error("Error starting avatar streaming session:", error);
      return false;
    }
  };

  const createAvatarSession = async () => {
    try {
      console.log("Creating new HeyGen avatar session...");
      
      // Get new session token
      const newSessionToken = await getAvatarSessionToken();

      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newSessionToken}`,
        },
        body: JSON.stringify({
          quality: "high",
          avatar_id: "Ann_Therapist_public", // Use Ann Therapist public avatar
          participant_name: `therapy-user-${Date.now()}`, // Unique participant to prevent conflicts
          version: "v2",
          video_encoding: "H264",
        }),
      });

      const data = await response.json();
      console.log("Avatar streaming new response:", data);

      if (data.data && data.success !== false) {
        const newAvatarSessionId = data.data.session_id;
        console.log("✅ HeyGen avatar session created successfully:", newAvatarSessionId);
        
        // Start avatar streaming session
        const streamingStarted = await startAvatarStreamingSession(newAvatarSessionId, newSessionToken);
        
        if (streamingStarted) {
          console.log("✅ Avatar streaming session started successfully");
          return {
            sessionId: newAvatarSessionId,
            sessionToken: newSessionToken,
            wsUrl: data.data.url,
            token: data.data.access_token
          };
        } else {
          console.error("❌ Failed to start avatar streaming session");
          return null;
        }
      } else {
        console.error("❌ Failed to create HeyGen avatar session:", data);
        return null;
      }
    } catch (error) {
      console.error("Error creating HeyGen avatar session:", error);
      return null;
    }
  };

  // Function to send user message to our API and get response
  const processUserMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim()) return;

      // Prevent multiple simultaneous API calls
      if (isProcessingMessage || isSpeaking || isSpeechRecognitionDisabled) {
        console.log(
          "⏳ Already processing message, avatar speaking, or speech recognition disabled, skipping:",
          userMessage
        );
        return;
      }

      // Clear timers when user speaks
      onUserSpoke();

      try {
        setIsProcessingMessage(true);
        setIsProcessingFargateResponse(true);
        setCurrentTranscription(`Processing: "${userMessage}"`);
        console.log("🔍 PROCESSING USER MESSAGE:", userMessage);

        // Update conversation history with the user message
        const updatedMessages = [
          ...messages,
          { role: "user" as const, content: userMessage },
        ];
        setMessages(updatedMessages);

        console.log("📤 SENDING REQUEST TO FARGATE SERVICE VIA CLIENT WEBSOCKET");

        // Get therapod sessionId from URL parameters
        const currentTherapodSessionId = getTherapodSessionId();
        console.log("🔍 Therapod SessionId from URL parameters:", currentTherapodSessionId);

        // Send via client-side WebSocket service
        try {
          const payload = {
            messages: updatedMessages,
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
          console.log(
            "📝 RESPONSE FROM FARGATE (RAW TEXT LENGTH):",
            responseText.length
          );

          // Process the streaming response from Fargate (handling word-by-word chunks)
          let fullResponse = "";

          console.log("🔍 DEBUG: Raw response text:", responseText);
          console.log("🔍 DEBUG: Response text length:", responseText.length);
          console.log("🔍 DEBUG: Response text type:", typeof responseText);

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

            console.log(
              "✅ FINAL ASSEMBLED RESPONSE FROM FARGATE:",
              fullResponse
            );
            console.log("✅ FINAL RESPONSE LENGTH:", fullResponse.length);

            // Ensure we have a complete sentence (ends with punctuation)
            if (fullResponse.trim() && !fullResponse.trim().match(/[.!?]$/)) {
              console.log(
                "⚠️ Response doesn't end with punctuation, adding period"
              );
              fullResponse = fullResponse.trim() + ".";
            }

            // If no content was extracted, try fallback parsing
            if (!fullResponse.trim()) {
              console.log(
                "⚠️ No content extracted from chunks, trying fallback parsing"
              );
              try {
                const parsedResponse = JSON.parse(responseText);
                if (parsedResponse.content) {
                  fullResponse = parsedResponse.content;
                } else {
                  fullResponse = responseText.trim();
                }
              } catch (fallbackError) {
                console.log("⚠️ Fallback parsing failed, using raw text");
                fullResponse = responseText.trim();
              }
            }
          } catch (parseError) {
            console.log("⚠️ Error processing streaming response:", parseError);
            fullResponse = responseText.trim();
            console.log("✅ USING RAW TEXT RESPONSE:", fullResponse);
            console.log("✅ RAW TEXT RESPONSE LENGTH:", fullResponse.length);
          }

          if (!fullResponse.trim()) {
            console.error("❌ EMPTY RESPONSE FROM FARGATE SERVICE!");
            return;
          }

          // Add AI response to conversation history
          setMessages([
            ...updatedMessages,
            { role: "assistant" as const, content: fullResponse },
          ]);

          // Sanitize the response to make it more avatar-friendly
          // Clean and prepare response for speaking
          let sanitizedResponse = fullResponse
            // Replace any escaped quotes or backslashes
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            // Remove any JSON formatting artifacts
            .replace(/\\n/g, " ")
            .replace(/\\t/g, " ")
            // Remove any potential HTML tags
            .replace(/<[^>]*>/g, "")
            // Normalize whitespace
            .replace(/\s+/g, " ")
            .trim();

          // Truncate extremely long responses to prevent memory issues
          if (sanitizedResponse.length > 2000) {
            console.log("⚠️ Response too long, truncating to 2000 chars");
            sanitizedResponse = sanitizedResponse.substring(0, 1997) + "...";
          }

          console.log(
            "🔊 MAKING AVATAR SPEAK FARGATE RESPONSE:",
            sanitizedResponse.substring(0, 50) +
              (sanitizedResponse.length > 50 ? "..." : "")
          );
          console.log(
            "🔊 FULL SANITIZED RESPONSE LENGTH:",
            sanitizedResponse.length
          );
          console.log("🔊 FULL SANITIZED RESPONSE:", sanitizedResponse);
          setCurrentTranscription(
            `AI: "${sanitizedResponse.substring(0, 100)}${sanitizedResponse.length > 100 ? "..." : ""}"`
          );

          // Make the avatar speak using HeyGen avatar session
          if (avatarSessionId && avatarSessionToken && avatarConnected) {
            console.log("🔊 Making avatar speak via HeyGen:", sanitizedResponse);
            setIsSpeaking(true);
            
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
              
              // Simulate avatar speaking completion (in real implementation, listen for WebSocket events)
              setTimeout(() => {
                setIsSpeaking(false);
                onAvatarFinishedSpeaking();
              }, Math.max(3000, sanitizedResponse.length * 50)); // Estimate speaking time
              
            } catch (error) {
              console.error("❌ Error making avatar speak:", error);
              setIsSpeaking(false);
            }
          } else {
            console.log("🔊 HeyGen session not ready, simulating avatar speech");
            setIsSpeaking(true);
            setTimeout(() => {
              setIsSpeaking(false);
              onAvatarFinishedSpeaking();
            }, 3000);
          }

        } catch (error) {
          console.error("❌ Error in processUserMessage:", error);
        } finally {
          setIsProcessingMessage(false);
          setIsProcessingFargateResponse(false);
          setCurrentTranscription("");
        }
      } catch (error) {
        console.error("❌ Error in processUserMessage:", error);
      }
    },
    [messages, isProcessingMessage, isSpeaking, isSpeechRecognitionDisabled, avatarSessionId, avatarSessionToken, avatarConnected]
  );

  // Determine microphone status
  const getMicrophoneStatus = () => {
    if (isProcessingMessage) return { status: 'PROCESSING', color: '#FF9800', text: 'Processing...' };
    if (isSpeaking) return { status: 'SPEAKING', color: '#9C27B0', text: 'AI Speaking' };
    if (isRecording && isListening) return { status: 'LISTENING', color: '#4CAF50', text: 'Listening' };
    if (isRecording) return { status: 'RECORDING', color: '#FFA726', text: 'Recording' };
    return { status: 'OFF', color: '#999', text: 'Mic Off' };
  };

  const micStatus = getMicrophoneStatus();

  // If no LiveKit connection, show simple display
  if (!wsUrl || !token) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Speech Text Display */}
        <View style={styles.speechContainer}>
          <Text style={styles.speechTitle}>🎤 Speech Recognition:</Text>
          <View style={styles.speechTextContainer}>
            <Text style={styles.currentSpeechText}>
              {recognizedText || 'Listening...'}
            </Text>
          </View>
          
          {/* Current Processing Status */}
          {currentTranscription && (
            <View style={styles.processingContainer}>
              <Text style={styles.processingText}>
                {currentTranscription}
              </Text>
            </View>
          )}
        </View>
        
        {/* Microphone Status Button */}
        <View style={styles.statusContainer}>
          <View style={[styles.microphoneStatusButton, { backgroundColor: micStatus.color }]}>
            <Text style={styles.microphoneStatusText}>
              🎤 {micStatus.text}
            </Text>
          </View>
        </View>
        

      </SafeAreaView>
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
  const tracks = useTracks([{ source: "camera" as any, withPlaceholder: false }], { onlySubscribed: true });

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
            {recognizedText || 'Listening...'}
          </Text>
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
  processingContainer: {
    backgroundColor: "#FFF3E0",
    padding: 8,
    borderRadius: 5,
    marginTop: 5,
    borderLeftWidth: 3,
    borderLeftColor: "#FF9800",
  },
  processingText: {
    fontSize: 12,
    color: "#E65100",
    fontStyle: "italic",
  },
});