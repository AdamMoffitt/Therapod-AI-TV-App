import { useEffect, useState, useRef, useCallback } from "react";
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
import { WebView } from "react-native-webview";
import * as Sentry from '@sentry/react-native';

// const defaultVideoSource =
//   "https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/Mindful%20moment%20final.mp4?alt=media&token=91a4dcbf-d68c-4796-b6fe-551e80720fec";
// const defaultVideoSource = 'https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/defaultVideo.mp4?alt=media&token=3ede3c5d-fa13-4400-945a-21a09d4fa1cb'
// const defaultVideoSource = require('@/assets/videos/defaultVideo.mp4')

const defaultVideoSource = 'https://firebasestorage.googleapis.com/v0/b/therapod-454503.firebasestorage.app/o/defaultVideo_tv_safe.mp4?alt=media&token=b571b26b-b6ff-4f13-9b13-ef8045d5543c'
const { height, width } = Dimensions.get("screen");

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

  const recentVideos = useRef<MediaInfo[]>([]);
  const videoRef = useRef<Video>(null);
  const countdownAnimation = useRef(new Animated.Value(1)).current;
  const wellnessTimerInterval = useRef<NodeJS.Timeout | null>(null);
  const previousVideoSource = useRef<string>(defaultVideoSource);
  const isVideoLoaded = useRef<boolean>(false);

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

  useEffect(() => {
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
          
          setPodStatus(therapodData.status || "idle");

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

  // Wellness screen auto-restart timer
  useEffect(() => {
    // Clear any existing timer when component state changes
    if (wellnessTimerInterval.current) {
      clearInterval(wellnessTimerInterval.current);
      wellnessTimerInterval.current = null;
    }

    // Start the auto-restart timer when wellness screen is shown
    if (showWellnessScore) {
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

  // Show AI Therapy website
  // http://localhost:3000/avatar?userid=b89Vj19ihlbZOzIF8q659pgeSlP2&therapistName=Daniel&therapistId=Graham_Chair_Sitting_public&podId=KNOX-HUB-01
  if (sessionType === "ai_therapy" && podStatus === "active" && countdown === null) {
    let webViewUrl = `https://therapod-wellness-tv-webapp.vercel.app/avatar?autoStart=true&podId=${selectedPod}`;
    
    if (currentUserId) {
      webViewUrl += `&userId=${currentUserId}`;
    }
    
    if (currentTherapistName) {
      webViewUrl += `&therapistName=${currentTherapistName}`;
    }
    
    if (currentTherapistId) {
      webViewUrl += `&therapistId=${currentTherapistId}`;
    }
    
    if (currentSessionId) {
      webViewUrl += `&sessionId=${currentSessionId}`;
    }
    
    console.log("AI Therapy WebView URL:", webViewUrl);
    console.log("Current User ID:", currentUserId);
    console.log("Pod ID:", selectedPod);
    
    return (
      <View style={styles.webViewContainer}>
        <WebView
          source={{ uri: webViewUrl }}
          style={styles.webView}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsProtectedMedia={true}
          allowsFullscreenVideo={true}
          domStorageEnabled={true}
          javaScriptEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={true}
          bounces={false}
          scrollEnabled={false}
          onShouldStartLoadWithRequest={(request) => {
            // Allow all requests
            return true;
          }}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView error:', nativeEvent);
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView HTTP error:', nativeEvent);
          }}
        />
      </View>
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

  // Show video player
  return (
    <View style={styles.videoContainer}>
      {isVideoLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#A67B5B" />
          <Text style={styles.loadingText}>Loading your session...</Text>
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
          
          // Reset pod status to idle and clear now_playing on video error
          if (selectedPod) {
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
  webViewContainer: {
    flex: 1,
    position: "relative",
  },
  webView: {
    flex: 1,
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
});
