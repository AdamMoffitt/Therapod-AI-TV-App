import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  Animated,
  Pressable,
  findNodeHandle,
  Button,
  Platform,
  BackHandler,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  TextInput,
} from "react-native";
import { Video, AVPlaybackStatus, Audio, ResizeMode } from "expo-av";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/firebase";
import { getSelectedPod, saveSelectedPod, storage } from "@/utils/storage";
import QRCode from "react-native-qrcode-svg";
import * as Sentry from '@sentry/react-native';
import MicrophoneDisplay from "./MicrophoneDisplay";
import Guide from "./Guide";
// LiveKit imports removed - now using Guide.tsx for AI therapy

// Microphone Display Component removed - using imported component

// const defaultVideoSource =
//   "https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/Mindful%20moment%20final.mp4?alt=media&token=91a4dcbf-d68c-4796-b6fe-551e80720fec";
// const defaultVideoSource = 'https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/defaultVideo.mp4?alt=media&token=3ede3c5d-fa13-4400-945a-21a09d4fa1cb'
// const defaultVideoSource = require('@/assets/videos/defaultVideo.mp4')

const defaultVideoSource = 'https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/defaultVideo_tv_safe.mp4?alt=media&token=b571b26b-b6ff-4f13-9b13-ef8045d5543c'
const { height, width } = Dimensions.get("screen");

// HeyGen API Configuration
const API_CONFIG = {
  serverUrl: "https://api.heygen.com",
  apiKey: process.env.EXPO_PUBLIC_HEYGEN_API_KEY || "your_api_key_here",
};

interface Pod {
  id: string;
  name: string;
  session_type?: string;
}

interface MediaInfo {
  url: string;
  title: string;
  id: string | null;
}

// RoomView component removed - now using Guide.tsx for AI therapy sessions

export default function HomeScreenView() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [selectedPod, setSelectedPod] = useState<string | undefined>(undefined);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [videoSource, setVideoSource] = useState(defaultVideoSource);
  const [videoTitle, setVideoTitle] = useState("Mindful Meditation");
  const [showWellnessScore, setShowWellnessScore] = useState(false);
  const [podStatus, setPodStatus] = useState("idle");
  const [sessionType, setSessionType] = useState("meditation");
  const [wellnessScoreValue, setWellnessScoreValue] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [isVideoLoading, setIsVideoLoading] = useState(true); // Set to true initially
  const [wellnessScreenTimer, setWellnessScreenTimer] = useState(30); // Timer for wellness screen auto-restart
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentTherapistName, setCurrentTherapistName] = useState<string | null>(null);
  const [currentTherapistId, setCurrentTherapistId] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showErrorPopup, setShowErrorPopup] = useState<boolean>(false);

  // HeyGen LiveKit state
  const [wsUrl, setWsUrl] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [sessionToken, setSessionToken] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(0);
  const keepAliveInterval = useRef<NodeJS.Timeout | null>(null);
  const durationTracker = useRef<NodeJS.Timeout | null>(null);

  const recentVideos = useRef<MediaInfo[]>([]);
  const videoRef = useRef<Video>(null);
  const countdownAnimation = useRef(new Animated.Value(1)).current;
  const wellnessTimerInterval = useRef<NodeJS.Timeout | null>(null);
  const previousVideoSource = useRef<string>(defaultVideoSource);
  const isVideoLoaded = useRef<boolean>(false);
  const isInitializingSession = useRef<boolean>(false);

  const createAISession = async (podId: string, therapodData: any) => {
    try {
      // Get therapod data to extract location
      const therapodRef = doc(db, "therapods", podId);
      const therapodSnapshot = await getDoc(therapodRef);
      
      if (!therapodSnapshot.exists()) {
        console.error("Therapod not found");
        return;
      }
      
      const therapodInfo = therapodSnapshot.data();
      
      // Create session document
      const sessionData = {
        createdAt: serverTimestamp(),
        date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
        duration: "30 minutes",
        location: therapodInfo.location || podId.toLowerCase(),
        podId: podId,
        points: 0,
        sessionType: "ai_therapy",
        status: "active",
        therapist: therapodData.current_user?.therapist_id || "N6j3amuwz99kyJdOma4b",
        time: new Date().toLocaleTimeString('en-US', { 
          hour12: true, 
          hour: 'numeric', 
          minute: '2-digit', 
          second: '2-digit' 
        }).toLowerCase(),
        updatedAt: serverTimestamp(),
        userId: therapodData.current_user?.id || null
      };
      
      // Add session to sessions collection
      const sessionRef = await addDoc(collection(db, "sessions"), sessionData);
      const sessionId = sessionRef.id;
      
      console.log("Created session with ID:", sessionId);
      
      // Update therapod with session_id and set status to active
      await updateDoc(therapodRef, {
        "current_user.session_id": sessionId,
        status: "active",
        session_type: "ai_therapy"
      });
      
      console.log("Updated therapod with session_id and status");
      
    } catch (error) {
      console.error("Error creating AI session:", error);
    }
  };

  // HeyGen API Functions
  const getSessionToken = async () => {
    console.log('Making request to create token...');
    console.log('API Key (first 10 chars):', API_CONFIG.apiKey.substring(0, 10) + '...');
    
    const response = await fetch(
      `${API_CONFIG.serverUrl}/v1/streaming.create_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_CONFIG.apiKey}`,
        },
      }
    );
    
    console.log('Token response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token creation failed:', response.status, errorText);
      throw new Error(`Failed to create token: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Token response:', JSON.stringify(data, null, 2));
    
    if (!data || !data.data || !data.data.token) {
      console.error('Invalid token response structure:', data);
      throw new Error('Invalid response: missing token');
    }
    
    return data.data.token;
  };

  const createNewSession = async (sessionToken: string) => {
    console.log('Creating new session with token...');
    
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        quality: "high",
        version: "v2", 
        video_encoding: "H264",
        avatar_id: "Ann_Therapist_public", // Use the therapist avatar
        participant_name: `therapy-user-${Date.now()}`, // Unique participant to prevent conflicts
      }),
    });
    
    console.log('New session response status:', response.status);
    console.log('New session response headers:', response.headers);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Session creation failed:', response.status, errorText);
      throw new Error(`Failed to create session: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log('New session full response:', JSON.stringify(data, null, 2));
    
    if (!data || !data.data) {
      console.error('Invalid session response - no data property:', data);
      throw new Error('Invalid response: missing data property');
    }
    
    if (!data.data.session_id) {
      console.error('Invalid session response - no session_id:', data.data);
      throw new Error('Invalid response: missing session_id in data');
    }
    
    console.log('Successfully created session:', data.data.session_id);
    return data.data;
  };

  const startStreamingSession = async (
    sessionId: string,
    sessionToken: string
  ) => {
    console.log('Starting streaming session...');
    
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
      }),
    });
    
    console.log('Start streaming response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Start streaming failed:', response.status, errorText);
      throw new Error(`Failed to start streaming: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Start streaming full response:', JSON.stringify(data, null, 2));
    
    // HeyGen streaming.start may return success with data: null
    // This is actually normal - it just starts the streaming session
    if (!data || (data.code !== 100 && data.code !== 200)) {
      console.error('Invalid start streaming response:', data);
      throw new Error(`Invalid response: ${data?.message || 'Unknown error'}`);
    }
    
    console.log('✅ Streaming session started successfully - this creates the LiveKit room');
    return data; // Return the full response, data may be null and that's OK
  };

  const sendText = useCallback(async () => {
    try {
      setSpeaking(true);
      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
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
      });
      const data = await response.json();
      setText("");
    } catch (error) {
      console.error("Error sending text:", error);
    } finally {
      setSpeaking(false);
    }
  }, [sessionId, sessionToken, text]);

  // Handle closing HeyGen session - moved to top level to avoid Rules of Hooks violation
  const handleCloseSession = useCallback(async () => {
    console.log('🛑 End Session clicked - closing HeyGen session and setting pod to idle');
    
    // Close the HeyGen session
    await closeSession();
    
    // Set pod status to idle in Firebase
    if (selectedPod) {
      const therapodRef = doc(db, "therapods", selectedPod);
      try {
        await updateDoc(therapodRef, {
          status: "idle",
          now_playing: "",
        });
        console.log("✅ Pod status set to idle in Firebase");
        
        // Update local state
        setPodStatus("idle");
        setSessionType("meditation"); // Return to meditation view
      } catch (error) {
        console.error("❌ Error updating pod status to idle:", error);
      }
    }
  }, [selectedPod]);

  // Memoize LiveKit callbacks to prevent reconnection on every render
  const handleLiveKitConnected = useCallback(() => {
    console.log('✅ LiveKit room connected successfully');
    
    // Send initial greeting to activate the avatar (streaming session already started during init)
    if (currentTherapistName && sessionId && sessionToken) {
      setTimeout(async () => {
        try {
          console.log('🤖 Sending initial greeting to activate avatar...');
          const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({
              session_id: sessionId,
              text: `Hello! I'm ready to start our 30-minute therapy session. How are you feeling today?`,
              task_type: "talk",
            }),
          });
          const data = await response.json();
          console.log('✅ Initial greeting sent successfully:', data);
          
          // Start a keep-alive mechanism to maintain 30-minute session
          console.log('🔄 Starting 30-minute keep-alive mechanism...');
          
          // Set up aggressive keep-alive interval every 2 minutes 
          // Since HeyGen's timeout parameters don't work via REST API
          if (keepAliveInterval.current) {
            clearInterval(keepAliveInterval.current);
          }
          
          keepAliveInterval.current = setInterval(() => {
            console.log('⏰ 2-minute keep-alive timer triggered');
            keepSessionAlive();
          }, 120000); // 2 minutes in milliseconds
          
          console.log('✅ Keep-alive mechanism active - pinging every 2 minutes to maintain session');
          console.log('ℹ️ Note: HeyGen may still disconnect after responses - this is their default behavior');
          
          // Start session duration tracker
          const sessionStartTime = Date.now();
          durationTracker.current = setInterval(() => {
            const elapsedMinutes = Math.floor((Date.now() - sessionStartTime) / 60000);
            setSessionDurationMinutes(elapsedMinutes);
            
            if (elapsedMinutes >= 30) {
              if (durationTracker.current) {
                clearInterval(durationTracker.current);
                durationTracker.current = null;
              }
              console.log('⏰ 30-minute session limit reached');
            }
          }, 60000); // Update every minute
          
        } catch (error) {
          console.error('❌ Failed to send initial greeting:', error);
        }
      }, 2000); // Give LiveKit a moment to fully establish
    }
  }, [currentTherapistName, sessionId, sessionToken]);

  const handleLiveKitDisconnected = useCallback((reason?: any) => {
    console.log('❌ LiveKit room disconnected');
    console.log('Disconnection reason:', reason);
    
    // Don't handle disconnects during AI therapy sessions (now using Guide.tsx)
    if (sessionType === "ai_therapy") {
      console.log('🛡️ Ignoring LiveKit disconnect during AI therapy session (handled by Guide.tsx)');
      return;
    }
    
    // Map reason codes to human-readable messages
    const reasonMessages: { [key: number]: string } = {
      1: 'UNKNOWN',
      2: 'CLIENT_INITIATED', 
      3: 'DUPLICATE_IDENTITY',
      4: 'SERVER_SHUTDOWN',
      5: 'PARTICIPANT_REMOVED',
      6: 'ROOM_DELETED',
      7: 'STATE_MISMATCH',
      8: 'JOIN_FAILURE',
      9: 'MIGRATION',
      10: 'SIGNAL_CLOSE',
      11: 'ROOM_CLOSED',
      12: 'USER_UNAVAILABLE',
    };
    
    const reasonName = reasonMessages[reason] || 'UNKNOWN';
    console.log('Disconnection reason name:', reasonName);
    
    // Handle specific disconnection reasons
    if (reason === 5) { // PARTICIPANT_REMOVED
      console.log('🔍 PARTICIPANT_REMOVED - This usually means:');
      console.log('  1. HeyGen session timeout (normal after ~5-10 minutes)');
      console.log('  2. HeyGen detected duplicate participant identity');
      console.log('  3. HeyGen streaming session was ended by server');
      console.log('  4. Avatar generation completed');
      
      // For PARTICIPANT_REMOVED, this indicates session ended normally
      // With 30-minute timeout, this should only happen at the end of therapy session
      console.log('⚠️ Session ended by HeyGen (30-minute timeout or manual termination)');
      console.log('ℹ️ This is expected behavior - session completed normally');
      
      // Don't auto-restart - let the session end naturally
      // User can manually start a new session if needed
    }
    
    // Log additional context for debugging
    console.log('Current session state:', {
      sessionId,
      sessionToken: sessionToken ? 'Present' : 'Missing',
      connected,
      loading,
      wsUrl: wsUrl ? 'Present' : 'Missing',
      token: token ? 'Present' : 'Missing'
    });
    
    // Don't automatically try to reconnect, let user retry manually
    setConnected(false);
    isInitializingSession.current = false;
  }, [sessionId, sessionToken, connected, loading, wsUrl, token]);

  const handleLiveKitError = useCallback((error: any) => {
    console.error('🚨 LiveKit room error:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    
    // Don't handle errors during AI therapy sessions (now using Guide.tsx)
    if (sessionType === "ai_therapy") {
      console.log('🛡️ Ignoring LiveKit error during AI therapy session (handled by Guide.tsx)');
      return;
    }
    
    // Provide specific guidance based on error type
    if (error?.status === 404 || error?.message?.includes('room does not exist')) {
      console.error('🔍 Room does not exist - this usually means:');
      console.error('  1. startStreamingSession was not called successfully');
      console.error('  2. There was a delay between room creation and connection');
      console.error('  3. The HeyGen session was terminated');
    }
    
    if (error?.name === 'ConnectionError') {
      console.error('🌐 Connection error - check network and server URL');
    }
    
    // Reset connection state on error
    setConnected(false);
    // Prevent re-initialization on error
    isInitializingSession.current = false;
  }, []);



  // Memoize LiveKit options to prevent reconnection on every render
  const liveKitOptions = useMemo(() => ({
    adaptiveStream: { pixelDensity: "screen" as const },
    // Add additional connection reliability options
    autoSubscribe: true,
  }), []);

  // Validate LiveKit token for debugging - moved to top level to avoid Rules of Hooks violation
  useEffect(() => {
    if (token && token.length > 0 && sessionType === "ai_therapy") {
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const now = Math.floor(Date.now() / 1000);
          console.log('🔗 LiveKit token info:', {
            exp: payload.exp,
            now: now,
            timeUntilExpiry: payload.exp ? payload.exp - now : 'no expiry',
            room: payload.video?.room,
            identity: payload.sub
          });
          
          if (payload.exp && payload.exp < now) {
            console.error('⚠️ Token has expired!');
          }
        }
      } catch (error) {
        console.error('Failed to decode token:', error);
      }
    }
  }, [token, sessionType]);

  // Keep-alive function to maintain 30-minute session
  const keepSessionAlive = useCallback(async () => {
    if (!sessionId || !sessionToken) {
      return;
    }

    try {
      console.log('🔄 Sending keep-alive ping to maintain session...');
      // Send empty text task to keep session active
      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          text: "", // Empty text to reset idle timeout without visible output
          task_type: "talk",
        }),
      });

      if (response.ok) {
        console.log('✅ Keep-alive ping successful - session extended');
      } else {
        console.log('⚠️ Keep-alive ping failed - session may be ending');
      }
    } catch (error) {
      console.error('❌ Keep-alive ping error:', error);
    }
  }, [sessionId, sessionToken]);

  const closeSession = async () => {
    try {
      setLoading(true);
      
      // Clear keep-alive interval and duration tracker
      if (keepAliveInterval.current) {
        clearInterval(keepAliveInterval.current);
        keepAliveInterval.current = null;
        console.log('🛑 Keep-alive mechanism stopped');
      }
      if (durationTracker.current) {
        clearInterval(durationTracker.current);
        durationTracker.current = null;
        console.log('🛑 Duration tracker stopped');
      }
      
      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
        }),
      });

      // Reset states
      setConnected(false);
      setSessionId("");
      setSessionToken("");
      setWsUrl("");
      setToken("");
      setText("");
      setSpeaking(false);
    } catch (error) {
      console.error("Error closing session:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // WebRTC globals registration removed - now handled by Guide.tsx

    if (Platform.OS === 'android' && Platform.isTV) {
      // Import Audio from expo-av
      const setupAudio = async () => {
        try {
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false
          });
          console.log("Audio mode set successfully");
        } catch (error) {
          console.error("Error setting audio mode:", error);
        }
      };
      
      setupAudio();
    }
  }, []);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        console.log("Back button pressed");

        // If in AI therapy session, show confirmation dialog
        if (sessionType === "ai_therapy") {
          Alert.alert("Close Session", "Do you want to close this session?", [
            {
              text: "Cancel",
            },
            {
              text: "OK",
              onPress: () => {
                handleReturnToMeditation();
              },
              style: "default",
            },
          ]);
          return true; // Prevents default back action
        }

        if (sessionType === "meditation") {
          Alert.alert(
            "Exit Session",
            "Do you want to exit this session and return to pod selection?",
            [
              {
                text: "Cancel",
              },
              {
                text: "OK",
                onPress: () => {
                  // Clear local storage and reset selected pod
                  storage.clearAll();
                  setSelectedPod(undefined);
                },
                style: "default",
              },
            ]
          );
          return true; // Prevents default back action
        }

        // Default behavior for other screens
        if (Platform.OS === "android") {
          console.log("Back button pressed - ignoring on Android TV");
          return true; // Prevents default back action
        }

        return false;
      }
    );

    return () => backHandler.remove();
  }, [sessionType]);

  useEffect(() => {
    if (videoRef.current && isVideoPlaying) {

      // Adding explicit play with timeout for TV devices
      if (Platform.isTV) {
        const playTimer = setTimeout(() => {
          if (videoRef.current) {
            videoRef?.current
              ?.playAsync()
              .then(() => {
              })
              .catch((err: any) => {
             
              });
          }
        }, 1000);

        return () => clearTimeout(playTimer);
      }
    }
  }, [isVideoPlaying, videoSource]);

  useEffect(() => {
    const fetchPods = async () => {
      const podsCollection = await getDocs(collection(db, "therapods"));
      const podList = podsCollection.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Pod[];
      setPods(podList);
    };

    const loadSelectedPod = () => {
      const podId = getSelectedPod();
      if (podId) {
        setSelectedPod(podId);
      }
    };

    fetchPods();
    loadSelectedPod();
  }, []);

  // Set isVideoLoading to true whenever videoSource changes
  useEffect(() => {
    // Only set loading to true if we're changing to a different video source
    // or if the video hasn't been loaded yet
    if (videoSource !== previousVideoSource.current || !isVideoLoaded.current) {
      setIsVideoLoading(true);
      setShowErrorPopup(false); // Reset error popup when changing video source
      previousVideoSource.current = videoSource;
    }
  }, [videoSource]);

  useEffect(() => {
    let unsubscribe = () => {};
    let countdownInterval: NodeJS.Timeout;

    if (selectedPod) {
      const therapodRef = doc(db, "therapods", selectedPod);

      unsubscribe = onSnapshot(therapodRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
          const therapodData = docSnapshot.data();

          // Store current user ID and session ID for WebView
          setCurrentUserId(therapodData.current_user?.id || null);
          setCurrentSessionId(therapodData.current_user?.session_id || null);
          
          const therapistId = therapodData.current_user?.therapist_id || "N6j3amuwz99kyJdOma4b";
          const therapistRef = doc(db, "therapists", therapistId);
          getDoc(therapistRef).then((therapistSnapshot) => {
            if (therapistSnapshot.exists()) {
              const therapistData = therapistSnapshot.data();
              setCurrentTherapistName(therapistData.name || null);
              setCurrentTherapistId(therapistData.key);
            } else {
              setCurrentTherapistName(null);
              setCurrentTherapistId(null);
            }
          }).catch((error) => {
            console.error("Error fetching therapist data:", error);
            setCurrentTherapistName(null);
            setCurrentTherapistId(null);
          });
          // Set session type and pod status
          if (therapodData.session_type === "ai_therapy") {
            setSessionType("ai_therapy");
          } else {
            setSessionType("meditation");
          }
          
          // Don't reset pod status to idle during active AI therapy sessions
          // This prevents external Firebase updates from interrupting therapy
          if (therapodData.status === "idle" && sessionType === "ai_therapy") {
            console.log('🛡️ Preventing pod status reset to idle during AI therapy session');
            console.log('🛡️ Firebase wants to set status to "idle" but we are in AI therapy - ignoring');
            console.log('🛡️ Current sessionType:', sessionType, 'Firebase status:', therapodData.status);
            // Keep current pod status to maintain session
          } else {
            console.log('📱 Setting pod status from Firebase:', therapodData.status || "idle");
            setPodStatus(therapodData.status || "idle");
          }

          // Handle active sessions with countdown
          if (therapodData.status === "active") {
            // Reset wellness score view
            setShowWellnessScore(false);
            
            // Start countdown for all active sessions
            setCountdown(10);
            
            if (therapodData.session_type === "ai_therapy") {
              // Create session if session_id is not present
              if (!therapodData.current_user?.session_id) {
                createAISession(selectedPod, therapodData);
              }
              
              // Set up countdown timer for AI therapy (1 second intervals)
              countdownInterval = setInterval(() => {
                setCountdown((prev) => {
                  if (prev! <= 1) {
                    clearInterval(countdownInterval);
                    return null;
                  }
                  return prev! - 1;
                });
              }, 1000);
            } else if (therapodData.now_playing && therapodData.now_playing !== "") {
              // Set up countdown timer for meditation (2.5 second intervals)
              countdownInterval = setInterval(() => {
                setCountdown((prev) => {
                  if (prev! <= 1) {
                    clearInterval(countdownInterval);
                    loadMediaVideo(therapodData.now_playing);
                    return null;
                  }
                  return prev! - 1;
                });
              }, 2500);
            }
          } else if (therapodData.status === "completed") {
            // Session has been completed - show wellness score
            // Generate a random wellness score between 70-95 if not already set
            if (!showWellnessScore) {
              const randomScore = Math.floor(Math.random() * 26) + 70;
              setWellnessScoreValue(randomScore);
              setIsVideoPlaying(false);
              setShowWellnessScore(true);
            }
          } else if (
            !therapodData.now_playing &&
            therapodData.status !== "completed"
          ) {
            // No active video, play default
            setVideoSource(defaultVideoSource);
            setVideoTitle("Mindful Meditation");
            setIsVideoPlaying(true);
            setShowWellnessScore(false);
            setIsVideoLoading(true); // Set loading state to true for default video
          }
        }
      });
    }

    return () => {
      unsubscribe();
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [selectedPod]);

  // Animation for countdown
  useEffect(() => {
    if (countdown !== null) {
      // Reset the animation value
      countdownAnimation.setValue(1);

      // Start the pulse animation
      Animated.sequence([
        Animated.timing(countdownAnimation, {
          toValue: 1.2,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(countdownAnimation, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [countdown]);

  // HeyGen session initialization (LEGACY - now using Guide.tsx for AI therapy)
  useEffect(() => {
    const initializeSession = async () => {
      console.log('HeyGen useEffect triggered - sessionType:', sessionType, 'podStatus:', podStatus, 'countdown:', countdown, 'connected:', connected, 'loading:', loading, 'sessionId:', sessionId);
      
      // NOTE: This should not run for AI therapy sessions since we now use Guide.tsx
      if (sessionType === "ai_therapy") {
        console.log('🛡️ Skipping legacy HeyGen initialization - using Guide.tsx for AI therapy');
        return; // Exit early to prevent interference with Guide.tsx
      }
      
      // This code should only run for non-AI therapy sessions (legacy meditation mode)
      if (sessionType === "meditation" && podStatus === "active" && countdown === null && !connected && !loading && !sessionId && !isInitializingSession.current) {
        try {
          isInitializingSession.current = true;
          setLoading(true);
          console.log('🚀 Starting HeyGen session initialization...');

          // Get session token
          const token = await getSessionToken();
          setSessionToken(token);
          console.log('Got session token');

          // Create new session with unique participant identity
          const sessionData = await createNewSession(token);
          setSessionId(sessionData.session_id);
          console.log('Created session:', sessionData.session_id);
          console.log('Session will use participant identity:', `user-${currentUserId}-${Date.now()}`);

          // Use data directly from session creation
          setWsUrl(sessionData.url || '');
          setToken(sessionData.access_token || '');
          console.log('Session data configured - URL:', sessionData.url);
          console.log('Session data configured - Token:', sessionData.access_token ? 'Present' : 'Missing');

          // Start streaming to create the LiveKit room - this is REQUIRED for room to exist
          try {
            console.log('🎬 Starting streaming session to create LiveKit room...');
            console.log('Using session_id:', sessionData.session_id);
            console.log('Using session_token:', token ? 'Present' : 'Missing');
            console.log('Will connect to room URL:', sessionData.url);
            
            const streamData = await startStreamingSession(sessionData.session_id, token);
            console.log('✅ Streaming session started successfully, LiveKit room created');
            console.log('Stream data received:', streamData);
            
            // Wait a moment for the LiveKit room to be fully provisioned
            console.log('⏳ Waiting for LiveKit room to be fully provisioned...');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Increased delay for stability
            console.log('✅ Room provisioning delay completed');
          } catch (error) {
            console.error('❌ Failed to start streaming session:', error);
            
            // Log the full error details
            if (error instanceof Error) {
              console.error('Error message:', error.message);
              console.error('Error stack:', error.stack);
            }
            
            // Don't throw immediately - try to continue with LiveKit connection
            // Sometimes the room exists even if streaming start has issues
            console.log('⚠️ Continuing with LiveKit connection despite streaming error...');
            
            // Still wait a bit for potential room creation
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          setConnected(true);
          isInitializingSession.current = false; // Mark as completed successfully
          console.log('✅ HeyGen session initialization completed successfully');

        } catch (error) {
          console.error('Error initializing session:', error);
          
          // More specific error handling
          let errorMessage = 'Failed to connect to the AI therapist. Please try again.';
          if (error instanceof Error) {
            if (error.message.includes('API key')) {
              errorMessage = 'API configuration error. Please check your settings.';
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
              errorMessage = 'Network connection error. Please check your internet connection.';
            } else if (error.message.includes('session')) {
              errorMessage = 'Session creation failed. Please try again.';
            }
          }
          
          Alert.alert(
            'Connection Error',
            errorMessage,
            [
              { text: 'Retry', onPress: () => {
                // Reset and try again
                setConnected(false);
                setLoading(false);
                isInitializingSession.current = false;
                // The useEffect will trigger again automatically
              }},
              { text: 'Back to Menu', onPress: handleReturnToMeditation }
            ]
          );
        } finally {
          setLoading(false);
          isInitializingSession.current = false;
        }
      }
    };

    initializeSession();
  }, [sessionType, podStatus, countdown]);

  // Wellness screen auto-restart timer
  useEffect(() => {
    // Clear any existing timer when component state changes
    if (wellnessTimerInterval.current) {
      clearInterval(wellnessTimerInterval.current);
      wellnessTimerInterval.current = null;
    }

    // Start the auto-restart timer when wellness screen is shown
    // BUT NOT during AI therapy sessions
    if (showWellnessScore && sessionType !== "ai_therapy") {
      setWellnessScreenTimer(30); // Reset to 30 seconds

      wellnessTimerInterval.current = setInterval(() => {
        setWellnessScreenTimer((prev) => {
          if (prev <= 1) {
            // When timer reaches 0, start over automatically
            clearInterval(wellnessTimerInterval.current!);
            wellnessTimerInterval.current = null;
            handleStartOver();
            return 30; // Reset to 30 but it won't be used immediately
          }
          return prev - 1;
        });
      }, 1000);
    }

    // Cleanup function
    return () => {
      if (wellnessTimerInterval.current) {
        clearInterval(wellnessTimerInterval.current);
        wellnessTimerInterval.current = null;
      }
    };
  }, [showWellnessScore]);

  // HeyGen session cleanup
  useEffect(() => {
    return () => {
      if (sessionId && sessionToken) {
        closeSession().catch(console.error);
      }
    };
  }, [sessionId, sessionToken]);

  // Reset HeyGen state when leaving AI therapy
  useEffect(() => {
    if (sessionType !== "ai_therapy" && (connected || sessionId || sessionToken)) {
      console.log('Resetting HeyGen state - sessionType changed to:', sessionType);
      setConnected(false);
      setSessionId("");
      setSessionToken("");
      setWsUrl("");
      setToken("");
      setText("");
      setSpeaking(false);
      setLoading(false);
      setSessionDurationMinutes(0); // Reset session duration
      isInitializingSession.current = false;
      
      // Clear keep-alive interval and duration tracker when leaving AI therapy
      if (keepAliveInterval.current) {
        clearInterval(keepAliveInterval.current);
        keepAliveInterval.current = null;
        console.log('🛑 Keep-alive mechanism stopped (session type changed)');
      }
      if (durationTracker.current) {
        clearInterval(durationTracker.current);
        durationTracker.current = null;
        console.log('🛑 Duration tracker stopped (session type changed)');
      }
    }
  }, [sessionType, connected, sessionId, sessionToken]);

  const loadMediaVideo = async (mediaId: string) => {
    setIsVideoLoading(true); // Start loading indicator
    setShowErrorPopup(false); // Reset error popup
    isVideoLoaded.current = false; // Reset loaded flag

    const mediaRef = doc(db, "media", mediaId);
    const mediaSnapshot = await getDoc(mediaRef);

    if (mediaSnapshot.exists()) {
      const mediaData = mediaSnapshot.data();
      const mediaUrl = mediaData.video_url || mediaData.url;

      if (mediaUrl) {
        // Store the current video info in recent videos
        const newVideoInfo = {
          url: mediaUrl,
          title: mediaData.title || "Mindful Meditation",
          id: mediaId,
        };

        // Check if we already have this video in recent list
        const existingIndex = recentVideos.current.findIndex(
          (v) => v.url === mediaUrl
        );
        if (existingIndex >= 0) {
          // Move to front of list
          recentVideos.current.splice(existingIndex, 1);
        }

        // Add to start of list
        recentVideos.current.unshift(newVideoInfo);

        // Limit list to 5 items
        if (recentVideos.current.length > 5) {
          recentVideos.current.pop();
        }

        setVideoSource(mediaUrl);
        // setVideoSource(defaultVideoSource);
        setVideoTitle(mediaData.title || "Mindful Meditation");
        setShowWellnessScore(false);
        setIsVideoPlaying(true);
      }
    }
  };

  const handleVideoEnd = useCallback(async () => {
    console.log("Video ended");

    if (selectedPod && podStatus === "active") {
      // Generate a random wellness score between 70-95
      const randomScore = Math.floor(Math.random() * 26) + 70;
      setWellnessScoreValue(randomScore);

      // Stop video playback
      setIsVideoPlaying(false);

      // Show wellness score after video ends
      setShowWellnessScore(true);

      // Update the pod document to remove now_playing and update status
      const therapodRef = doc(db, "therapods", selectedPod);
      try {
        await updateDoc(therapodRef, {
          now_playing: "",
          status: "completed",
        });
        console.log("Firebase updated: status=completed");
      } catch (error) {
        console.error("Error updating Firebase:", error);
      }
    }
  }, [selectedPod, podStatus]);

  const handleStartOver = async () => {
    if (selectedPod) {
      // Update the pod document to reset status
      const therapodRef = doc(db, "therapods", selectedPod);
      try {
        await updateDoc(therapodRef, {
          now_playing: "",
          status: "idle",
        });
        console.log("Firebase updated: status=idle");
      } catch (error) {
        console.error("Error updating Firebase:", error);
      }
    }

    setIsVideoLoading(true); // Show loading indicator when starting over
    setShowErrorPopup(false); // Reset error popup
    isVideoLoaded.current = false; // Reset loaded flag
    setVideoSource(defaultVideoSource);
    setVideoTitle("Mindful Meditation");
    setShowWellnessScore(false);
    setPodStatus("idle");
    setIsVideoPlaying(true);
  };

  const handleSelectPod = (podId: string) => {
    saveSelectedPod(podId);
    setSelectedPod(podId);
  };

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsVideoLoading(false);
      isVideoLoaded.current = true;

      if (status.positionMillis && status.durationMillis) {
        const percentComplete =
          (status.positionMillis / status.durationMillis) * 100;
        if (percentComplete > 95 && !showWellnessScore) {
          console.log(`Video at ${percentComplete.toFixed(2)}% completion`);
        }
      }

      if (status.didJustFinish && !showWellnessScore) {
        console.log("Video didJustFinish = true");
        handleVideoEnd();
      }
    } else if (status.error) {
      Sentry.captureException(status.error, {
        tags: {
          videoSource,
          podId: selectedPod,
          platform: Platform.OS,
          isTV: Platform.isTV
        },
        extra: {
          errorMessage: status.error,
          videoUrl: videoSource
        }
      });
      console.error("Video loading error:", status.error);
      setIsVideoLoading(false);
      setShowErrorPopup(true);
      
      // Hide popup after 5 seconds
      setTimeout(() => {
        setShowErrorPopup(false);
      }, 5000);
      
      isVideoLoaded.current = false;
    }
  };

  const handleReturnToMeditation = async () => {
    if (selectedPod) {
      const therapodRef = doc(db, "therapods", selectedPod);
      try {
        await updateDoc(therapodRef, {
          session_type: "meditation",
          status: "idle",
          now_playing: "",
        });
        console.log("Firebase updated: session_type=meditation");
        setSessionType("meditation");
      } catch (error) {
        console.error("Error updating Firebase:", error);
      }
    }
  };



  // Get wellness score color based on the value
  const getWellnessScoreColor = (score: number) => {
    if (score >= 90) return "#4CAF50"; // Green
    if (score >= 80) return "#8BC34A"; // Light Green
    if (score >= 70) return "#FFC107"; // Amber
    return "#FF9800"; // Orange
  };

  const podRefs = useRef<Array<any>>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);

  if (!selectedPod) {
    return (
      <View style={styles.contentContainer}>
        <Text style={styles.title}>Choose Your Therapod</Text>
        <FlatList
          data={pods}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.flatListContent}
          columnWrapperStyle={styles.columnWrapper}
          renderItem={({ item, index }) => (
            <View style={styles.nativeButtonWrapper}>
              <Button
                title={item.id}
                onPress={() => handleSelectPod(item.id)}
                hasTVPreferredFocus={index === 0}
              />
            </View>
          )}
        />
      </View>
    );
  }

  // Show AI Therapy with Guide component
  if (sessionType === "ai_therapy" && podStatus === "active" && countdown === null) {
    // return (
    //   <Guide 
    //     onSessionEnd={handleCloseSession}
    //     userId={currentUserId}
    //     therapistName={currentTherapistName}
    //   />
    // );
    return (
    <MicrophoneDisplay 
      onSessionEnd={handleCloseSession}
      userId={currentUserId}
      therapistName={currentTherapistName}
     />
    );
  }

  // Show countdown screen
  if (countdown !== null) {
    return (
      <View style={styles.countdownContainer}>
        <Text style={styles.countdownTitle}>
          Your session is about to begin
        </Text>
        <Animated.Text
          style={[
            styles.countdownNumber,
            { transform: [{ scale: countdownAnimation }] },
          ]}
        >
          {countdown}
        </Animated.Text>
        <Text style={styles.countdownSubtitle}>
          Take a deep breath and prepare...
        </Text>
          <View style={styles.disclaimerContainer}>
            <Text style={styles.disclaimerText}>
              Therapod AI is not a licensed therapist and does not provide clinical diagnosis, treatment, or therapy services.
            </Text>
            <Text style={styles.disclaimerText}>
              If you are in crisis or need professional support, please consult a licensed provider.
            </Text>
          </View>
      </View>
    );
  }

  // Show wellness score screen with auto-restart countdown
  if (showWellnessScore) {
    return (
      <View style={styles.wellnessContainer}>
        <Text style={styles.wellnessTitle}>Session Complete</Text>

        <View style={styles.scoreContainer}>
          <Text style={styles.wellnessScoreLabel}>Your Wellness Score</Text>
          <Text
            style={[
              styles.wellnessScoreValue,
              { color: getWellnessScoreColor(wellnessScoreValue) },
            ]}
          >
            {wellnessScoreValue}
          </Text>
        </View>

        <Text style={styles.wellnessSubtitle}>
          Scan the QR code for detailed wellness analysis
        </Text>

        <View style={styles.qrContainer}>
          <QRCode
            value="https://therapod.health/wellness-score"
            size={150}
            backgroundColor="#FFF8F0"
            color="#A67B5B"
          />
        </View>

        <Text style={styles.autoRestartText}>
          Auto-restart in {wellnessScreenTimer} seconds...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.videoContainer}>
      {isVideoLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#A67B5B" />
          <Text style={styles.loadingText}>Loading your session...</Text>
        </View>
      )}
      {showErrorPopup && (
        <View style={styles.errorPopupContainer}>
          <View style={styles.errorPopup}>
            <Text style={styles.errorPopupTitle}>Unable to start session</Text>
            <Text style={styles.errorPopupMessage}>
              Please try again or reach out to contact@therapodai.com for support
            </Text>
          </View>
        </View>
      )}
      <Video
        ref={videoRef}
        source={typeof videoSource === 'string' ? { uri: videoSource } : videoSource}
        style={styles.video}
        shouldPlay={isVideoPlaying}
        isMuted={false}
        isLooping={podStatus !== "active"}
        volume={1.0}
        useNativeControls
        resizeMode={ResizeMode.COVER}
        onReadyForDisplay={() => {
          console.log("Video ready for display");
          setIsVideoLoading(false);
          isVideoLoaded.current = true;
        }}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        onError={async (error: any) => {
          Sentry.captureException(error, {
            tags: {
              videoSource,
              podId: selectedPod,
              platform: Platform.OS,
              isTV: Platform.isTV
            },
            extra: {
              errorMessage: error?.message || "Unknown error",
              videoUrl: videoSource
            }
          });
          
          console.error("Video error:", error);
          setIsVideoLoading(false);
          setShowErrorPopup(true);
          
          // Hide popup after 5 seconds
          setTimeout(() => {
            setShowErrorPopup(false);
          }, 5000);
          
          // Reset pod status to idle and clear now_playing on video error
          // BUT NOT during AI therapy sessions
          if (selectedPod && sessionType !== "ai_therapy") {
            try {
              const therapodRef = doc(db, "therapods", selectedPod);
              await updateDoc(therapodRef, {
                status: "idle",
                now_playing: "",
              });
              console.log("Pod status reset to idle due to video error");
            } catch (updateError) {
              console.error("Error resetting pod status:", updateError);
            }
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    flex: 1,
    backgroundColor: "#FFF8F0", // light skin tone
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 30,
    color: "#A67B5B", // soft brown
  },
  flatListContent: {
    justifyContent: "center",
  },
  nativeButtonWrapper: {
    width: width * 0.45,
    marginBottom: 20,
  },
  columnWrapper: {
    justifyContent: "space-between",
    marginBottom: 20,
  },
  podButton: {
    backgroundColor: "#F5DEB3", // goldish
    width: width * 0.45,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
    height: height * 0.2,
  },
  focusedPodButton: {
    borderWidth: 3,
    borderColor: "#A67B5B",
    transform: [{ scale: 1.05 }],
  },
  podButtonText: {
    color: "#5C4033",
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
  },
  videoContainer: {
    flex: 1,
    backgroundColor: "#000", // dark background for video
    justifyContent: "center",
    alignItems: "center",
  },
  videoTitle: {
    position: "absolute",
    top: 50,
    color: "#FFF",
    fontSize: 18,
    fontWeight: "500",
    zIndex: 10,
  },
  video: {
    height: "100%",
    width: "100%",
  },
  countdownContainer: {
    flex: 1,
    backgroundColor: "#F5DEB3",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  countdownTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#5C4033",
    marginBottom: 30,
    textAlign: "center",
  },
  countdownNumber: {
    fontSize: 80,
    fontWeight: "bold",
    color: "#A67B5B",
    marginVertical: 30,
  },
  countdownSubtitle: {
    fontSize: 18,
    color: "#5C4033",
    textAlign: "center",
  },
  wellnessContainer: {
    flex: 1,
    backgroundColor: "#FFF8F0",
    alignItems: "center",
    padding: 20,
  },
  wellnessTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: "#A67B5B",
    marginBottom: 15,
  },
  wellnessSubtitle: {
    fontSize: 18,
    color: "#5C4033",
    marginBottom: 10,
    textAlign: "center",
  },
  scoreContainer: {
    alignItems: "center",
  },
  wellnessScoreLabel: {
    fontSize: 18,
    color: "#5C4033",
    marginBottom: 5,
  },
  wellnessScoreValue: {
    fontSize: 50,
    fontWeight: "bold",
  },
  qrContainer: {
    padding: 20,
    backgroundColor: "#FFF",
    borderRadius: 20,
    shadowColor: "#A67B5B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
    marginBottom: 20,
  },
  autoRestartText: {
    marginTop: 20,
    fontSize: 16,
    color: "#5C4033",
    fontStyle: "italic",
  },

  returnButton: {
    position: "absolute",
    bottom: 30,
    backgroundColor: "#F5DEB3",
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 100,
    left: 30,
  },
  returnButtonText: {
    color: "#5C4033",
    fontSize: 18,
    fontWeight: "500",
  },
  loadingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    zIndex: 10,
  },
  loadingText: {
    color: "#FFF",
    fontSize: 18,
    marginTop: 10,
  },
  disclaimerContainer: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  disclaimerText: {
    fontSize: 14,
    color: "#5C4033",
    textAlign: "center",
    lineHeight: 20,
    fontStyle: "italic",
    fontWeight: "300",
  },
  errorPopupContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    zIndex: 20,
  },
  errorPopup: {
    backgroundColor: "#FFF8F0",
    paddingVertical: 30,
    paddingHorizontal: 40,
    borderRadius: 20,
    maxWidth: "80%",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  errorPopupTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#A67B5B",
    marginBottom: 15,
    textAlign: "center",
  },
  errorPopupMessage: {
    fontSize: 16,
    color: "#5C4033",
    textAlign: "center",
    lineHeight: 22,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#FFF8F0",
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: "#A67B5B",
    marginBottom: 20,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 18,
    color: "#5C4033",
    textAlign: "center",
    lineHeight: 26,
    marginBottom: 40,
    paddingHorizontal: 20,
  },
  retryButton: {
    backgroundColor: "#A67B5B",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  retryButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  // LiveKit/HeyGen styles
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoView: {
    width: width,
    height: height * 0.7,
    backgroundColor: '#000',
  },
  loadingVideoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlsContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    marginRight: 12,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#A67B5B',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#666',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeButton: {
    backgroundColor: '#d32f2f',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  speakingIndicator: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(166, 123, 91, 0.2)',
    borderRadius: 8,
    alignItems: 'center',
  },
  speakingText: {
    color: '#A67B5B',
    fontSize: 14,
    fontStyle: 'italic',
  },
  conversationIndicator: {
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 6,
    alignItems: 'center',
  },
  conversationText: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '500',
  },
});
