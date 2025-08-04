// services/FirebaseListener.tsx
import React, { useEffect } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import * as FileSystem from 'expo-file-system';
import { FirebaseListenerProps, TherapodData, MediaData } from '../types';

// Helper function to extract Drive ID
const extractDriveId = (url: string): string => {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("drive.google.com")) {
      if (parsed.pathname.includes("/file/d/")) {
        const parts = parsed.pathname.split("/");
        const fileIdIndex = parts.indexOf("d") + 1;
        if (fileIdIndex < parts.length) {
          return parts[fileIdIndex];
        }
      }

      const idParam = parsed.searchParams.get("id");
      if (idParam) {
        return idParam;
      }
    }
  } catch (e) {
    console.error("Error parsing URL:", e);
  }
  return "";
};

const FirebaseListener: React.FC<FirebaseListenerProps> = ({ 
  db, podId, onVideoChange, onPrefetchProgress 
}) => {
  useEffect(() => {
    if (!podId) return;

    const therapodRef = doc(db, "therapods", podId);
    const unsubscribe = onSnapshot(therapodRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const therapodData = docSnapshot.data() as TherapodData;
        console.log("Updated Data:", therapodData);

        // Skip processing if session_type is ai_therapy
        if (therapodData.session_type === "ai_therapy") {
          return;
        }

        if (therapodData.now_playing && therapodData.now_playing !== "") {
          const mediaRef = doc(db, "media", therapodData.now_playing);
          getDoc(mediaRef).then((mediaSnapshot) => {
            if (mediaSnapshot.exists()) {
              const mediaData = mediaSnapshot.data() as MediaData;
              // Get the video URL - prioritize video_url if it exists, otherwise use url
              const mediaUrl = mediaData.video_url || mediaData.url;

              if (mediaUrl) {
                prefetchVideo(mediaUrl).then(finalUrl => {
                  onVideoChange(
                    finalUrl, 
                    mediaData.title || "Mindful Meditation"
                  );
                });
              }
            }
          });
        }
      }
    });

    return () => unsubscribe();
  }, [db, podId]);

  // Prefetch video function
  const prefetchVideo = async (url: string): Promise<string> => {
    try {
      // Create a unique filename based on the URL
      const filename = `${FileSystem.cacheDirectory}video-${Date.now()}.mp4`;
      
      // If it's a Google Drive URL, return it directly
      if (url.includes("drive.google.com")) {
        const fileId = extractDriveId(url);
        if (fileId) {
          onPrefetchProgress(100); // Skip progress for Drive videos
          return url; // Return the original URL for Google Drive videos
        }
        return url;
      }
      
      // Start the download
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        filename,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite * 100;
          onPrefetchProgress(Math.round(progress));
        }
      );
      
      // Start the download and wait for it to complete
      const { uri } = await downloadResumable.downloadAsync();
      console.log('Video cached at:', uri);
      
      // Return the local URI to play from cache
      return uri;
    } catch (error) {
      console.error('Error caching video:', error);
      onPrefetchProgress(100); // Mark as complete even if failed
      // If caching fails, fall back to streaming from the original URL
      return url;
    }
  };

  return null; // This component doesn't render anything visible
};

export default FirebaseListener;