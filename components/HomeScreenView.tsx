import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
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
import StartSession from "./StartSession";

const defaultVideoSource = 'https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/defaultVideo_tv_safe.mp4?alt=media&token=b571b26b-b6ff-4f13-9b13-ef8045d5543c'
const { height, width } = Dimensions.get("screen");

// Note: HeyGen API configuration moved to HeyGenAvatarStreamingService.ts

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

// Note: RoomView component moved to InteractiveAvatar.tsx

export default function HomeScreenView() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [selectedPod, setSelectedPod] = useState<string | undefined>(undefined);
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
  const [currentTherapodData, setCurrentTherapodData] = useState<any | null>(null);

  // Note: HeyGen session state variables moved to InteractiveAvatar.tsx

  const recentVideos = useRef<MediaInfo[]>([]);
  const videoRef = useRef<Video>(null);
  // Note: Countdown animation moved to StartSession.tsx
  const wellnessTimerInterval = useRef<NodeJS.Timeout | null>(null);
  const previousVideoSource = useRef<string>(defaultVideoSource);
  const isVideoLoaded = useRef<boolean>(false);
  // Note: isInitializingSession moved to InteractiveAvatar.tsx


  // Note: All HeyGen API functions moved to HeyGenAvatarStreamingService.ts
  // These functions are deprecated and should be removed

  // Handle closing session - now delegated to StartSession/InteractiveAvatar
  const handleCloseSession = useCallback(async () => {
    console.log('🛑 End Session clicked - returning to meditation view');
    
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

  // Note: All LiveKit and HeyGen session management moved to InteractiveAvatar.tsx
  // These functions are deprecated and should be removed

  useEffect(() => {
    // Note: WebRTC globals registration moved to InteractiveAvatar.tsx

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
    // Note: countdownInterval moved to StartSession.tsx

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
            let therapistName = null;
            if (therapistSnapshot.exists()) {
              const therapistData = therapistSnapshot.data();
              therapistName = therapistData.name || null;
              setCurrentTherapistId(therapistData.key);
            } else {
              setCurrentTherapistId(null);
            }
            
            // Store therapod data with therapist name for StartSession
            setCurrentTherapodData({
              ...therapodData,
              therapist_name: therapistName
            });
            setCurrentTherapistName(therapistName);
          }).catch((error) => {
            console.error("Error fetching therapist data:", error);
            setCurrentTherapistId(null);
            setCurrentTherapistName(null);
            
            // Store therapodData with null therapist name
            setCurrentTherapodData({
              ...therapodData,
              therapist_name: null
            });
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

          // Handle active sessions
          if (therapodData.status === "active") {
            // Reset wellness score view
            setShowWellnessScore(false);
            
            if (therapodData.session_type === "ai_therapy") {
              // Note: Firebase session creation moved to StartSession.tsx
              // This function call is deprecated and should be removed
              
              // StartSession will handle countdown and session creation
            } else if (therapodData.now_playing && therapodData.now_playing !== "") {
              // Load meditation video immediately
              loadMediaVideo(therapodData.now_playing);
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
    };
  }, [selectedPod]);

  // Note: Countdown animation moved to StartSession.tsx

  // Note: HeyGen session initialization moved to StartSession.tsx
  // This useEffect is deprecated and should be removed

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

  // Show AI Therapy with StartSession component
  if (sessionType === "ai_therapy" && podStatus === "active") {
    return (
    <StartSession 
      onSessionEnd={handleCloseSession}
      countdown={10}
      podId={selectedPod}
      therapodData={currentTherapodData}
     />
    );
  }

  // Note: Countdown screen moved to StartSession.tsx
  // This countdown logic is deprecated and should be removed

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
  // Note: Countdown styles moved to StartSession.tsx
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
