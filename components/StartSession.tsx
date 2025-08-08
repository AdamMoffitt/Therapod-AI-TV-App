import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { heyGenAvatarStreamingService } from '../services/HeyGenAvatarStreamingService';
import { therapodWebSocketService } from '../services/TherapodWebsocketService';
import InteractiveAvatar from './InteractiveAvatar';
import { doc, getDoc, addDoc, collection, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

interface TherapodData {
  current_user?: {
    id?: string;
    therapist_id?: string;
    session_id?: string;
  };
  therapist_name?: string | null;
  status?: string;
  session_type?: string;
  location?: string;
}

interface StartSessionProps {
  onSessionEnd: () => void;
  countdown: number | null;
  podId: string | null;
  therapodData: TherapodData | null;
}

interface AvatarSessionData {
  avatarSessionId: string;
  avatarSessionToken: string;
  avatarWsUrl: string;
  avatarAccessToken: string;
  avatarLivekitUrl: string;
}

interface TherapodSessionData {
  userId: string | null;
  therapistName: string | null;
  sessionId: string;
  podId: string;
}

interface SessionData {
  avatarSession: AvatarSessionData;
  therapodSession: TherapodSessionData;
}

export default function StartSession({ onSessionEnd, countdown, podId, therapodData }: StartSessionProps) {
  const [internalCountdown, setInternalCountdown] = useState<number | null>(countdown || null);
  const [isCreatingAvatarSession, setIsCreatingAvatarSession] = useState(false);
  const [isCreatingTherapodSession, setIsCreatingTherapodSession] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Extract userId and therapistName from therapodData
  const userId = therapodData?.current_user?.id || null;
  const therapistName = therapodData?.therapist_name || null;

  // Firebase session creation function
  const createFirebaseSession = async (podId: string, therapodData: TherapodData) => {
    try {
      // Get therapod data to extract location
      const therapodRef = doc(db, "therapods", podId);
      const therapodSnapshot = await getDoc(therapodRef);
      
      if (!therapodSnapshot.exists()) {
        console.error("Therapod not found");
        return null;
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
      
      console.log("Created Firebase session with ID:", sessionId);
      
      // Update therapod with session_id and set status to active
      await updateDoc(therapodRef, {
        "current_user.session_id": sessionId,
        status: "active",
        session_type: "ai_therapy"
      });
      
      console.log("Updated therapod with session_id and status");
      
      return sessionId;
    } catch (error) {
      console.error("Error creating Firebase session:", error);
      return null;
    }
  };

  // Handle countdown and session initialization
  useEffect(() => {
    if (internalCountdown !== null && internalCountdown > 0) {
      // Start countdown timer
      const countdownInterval = setInterval(() => {
        setInternalCountdown((prev) => {
          if (prev! <= 1) {
            return null;
          }
          return prev! - 1;
        });
      }, 1000);

      // Start avatar session creation immediately when countdown begins
      if (!isCreatingAvatarSession && retryCount < 3) {
        console.log(`🚀 Starting avatar session creation (attempt ${retryCount + 1}/3) as countdown begins...`);
        setIsCreatingAvatarSession(true);
        
        heyGenAvatarStreamingService.createAvatarSession().then(async (avatarData) => {
          if (avatarData) {
            console.log("✅ Avatar session created during countdown:", avatarData);
            
            // Create Firebase session
            setIsCreatingTherapodSession(true);
            console.log("🔥 Creating Firebase session...");
            
            // Use real data passed from HomeScreenView
            if (!therapodData || !podId) {
              console.error("Missing required therapodData or podId");
              setError("Missing session data - will retry");
              setIsCreatingAvatarSession(false);
              setRetryCount(prev => prev + 1);
              return;
            }
            
            const firebaseSessionId = await createFirebaseSession(podId, therapodData);
            
            setIsCreatingTherapodSession(false);
            
            if (firebaseSessionId) {
              // Store session data for when countdown ends
              setSessionData({
                avatarSession: {
                  avatarSessionId: avatarData.sessionId,
                  avatarSessionToken: avatarData.sessionToken,
                  avatarWsUrl: avatarData.wsUrl,
                  avatarAccessToken: avatarData.token,
                  avatarLivekitUrl: avatarData.livekitUrl,
                },
                therapodSession: {
                  userId: userId,
                  therapistName: therapistName,
                  sessionId: firebaseSessionId,
                  podId: podId,
                },
              });
            } else {
              setError("Failed to create Firebase session - will retry");
              setIsCreatingAvatarSession(false);
              setRetryCount(prev => prev + 1);
            }
            
          } else {
            console.error("❌ Failed to create avatar session during countdown");
            setIsCreatingAvatarSession(false);
            setError("Failed to create avatar session - will retry");
            setRetryCount(prev => prev + 1);
          }
        }).catch((error: any) => {
          console.error("❌ Error creating avatar session during countdown:", error);
          setIsCreatingAvatarSession(false);
          setError("Error creating avatar session - will retry");
          setRetryCount(prev => prev + 1);
        });
      }

      return () => clearInterval(countdownInterval);
    }
  }, [internalCountdown, isCreatingAvatarSession, therapodData, podId, retryCount]);

  // Handle retries when session creation fails
  useEffect(() => {
    if (error && retryCount > 0 && retryCount < 3 && !isCreatingAvatarSession) {
      const retryTimer = setTimeout(() => {
        console.log(`🔄 Retrying session creation (attempt ${retryCount + 1}/3)...`);
        setError(null); // Clear error for retry
        setIsCreatingAvatarSession(false); // Reset flag to allow retry
      }, 2000); // Wait 2 seconds before retry
      
      return () => clearTimeout(retryTimer);
    }
  }, [error, retryCount, isCreatingAvatarSession]);

  // Show countdown if it's active
  if (internalCountdown !== null && internalCountdown > 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.countdownContainer}>
          <Text style={styles.countdownTitle}>
            Your AI therapy session is about to begin
          </Text>
          <Text style={styles.countdownNumber}>
            {internalCountdown}
          </Text>
          {error && (
            <Text style={styles.countdownSubtitle}>
              Retrying... ({retryCount}/3)
            </Text>
          )}
    
          <View style={styles.disclaimerContainer}>
            <Text style={styles.disclaimerText}>
              Therapod AI is not a licensed therapist and does not provide clinical diagnosis, treatment, or therapy services.
            </Text>
            <Text style={styles.disclaimerText}>
              If you are in crisis or need professional support, please consult a licensed provider.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Show error if something went wrong and countdown is finished
  if (error && !sessionData && retryCount >= 3) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Session Setup Failed</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Text style={styles.errorSubtitle}>
            Please try again or contact support if the problem persists.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show loading if sessions are being prepared
  if (!sessionData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#A67B5B" />
        </View>
      </SafeAreaView>
    );
  }

  // Pass ready sessions to InteractiveAvatar
  return (
    <InteractiveAvatar 
      onSessionEnd={onSessionEnd}
      avatarSessionData={sessionData?.avatarSession}
      therapodSessionData={sessionData?.therapodSession}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF8F0",
  },
  countdownContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  countdownTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: "#A67B5B",
    marginBottom: 40,
    textAlign: "center",
  },
  countdownNumber: {
    fontSize: 72,
    fontWeight: "bold",
    color: "#A67B5B",
    marginBottom: 20,
  },
  countdownSubtitle: {
    fontSize: 18,
    color: "#5C4033",
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 40,
  },
  loadingContainer: {
    marginBottom: 40,
    width: '100%',
  },
  loadingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  loadingText: {
    fontSize: 16,
    color: "#5C4033",
    marginLeft: 10,
  },
  disclaimerContainer: {
    marginTop: 40,
    paddingHorizontal: 20,
  },
  disclaimerText: {
    fontSize: 14,
    color: "#8B7355",
    textAlign: "center",
    marginBottom: 8,
    fontStyle: "italic",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#D32F2F",
    marginBottom: 20,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 18,
    color: "#5C4033",
    marginBottom: 20,
    textAlign: "center",
  },
  errorSubtitle: {
    fontSize: 16,
    color: "#8B7355",
    textAlign: "center",
    fontStyle: "italic",
  },
});
