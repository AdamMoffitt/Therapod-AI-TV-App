// types/index.ts
export interface TherapodData {
    now_playing?: string;
    session_type?: string;
    [key: string]: any;
  }
  
  export interface MediaData {
    title?: string;
    url?: string;
    video_url?: string;
    [key: string]: any;
  }
  
  export interface FirebaseListenerProps {
    db: any;
    podId: string | null;
    onVideoChange: (url: string, title: string) => void;
    onPrefetchProgress: (progress: number) => void;
  }
  
  export interface VideoPlayerProps {
    videoUrl: string;
    isVisible: boolean;
    onVideoEnd: () => void;
  }
  
  export interface CountdownScreenProps {
    countdown: number;
    videoTitle: string;
    prefetchProgress: number;
  }
  
  export interface CompletedScreenProps {
    wellnessScore: number | null;
    videoTitle: string;
    onReturnHome: () => void;
  }