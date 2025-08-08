// HeyGen Avatar Streaming Service for managing avatar sessions

const API_CONFIG = {
  serverUrl: "https://api.heygen.com",
  apiKey: process.env.EXPO_PUBLIC_HEYGEN_API_KEY || "NDNmMDRlZDRlYjI3NDVjNjk3ODU3ZDVmZGMyNjk1OGItMTc1NDE0MjEyMQ==",
};

interface AvatarSessionData {
  sessionId: string;
  sessionToken: string;
  wsUrl: string; // HeyGen WebSocket URL (realtime_endpoint)
  token: string; // LiveKit access token
  livekitUrl: string; // LiveKit server URL for video
}

interface AvatarEventCallbacks {
  onAvatarSpeaking?: () => void;
  onAvatarFinished?: () => void;
  onTaskCompleted?: () => void;
}

class HeyGenAvatarStreamingService {
  private static instance: HeyGenAvatarStreamingService;
  private currentSession: AvatarSessionData | null = null;
  private isCreatingSession = false;
  private eventCallbacks: AvatarEventCallbacks = {};
  private websocket: WebSocket | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): HeyGenAvatarStreamingService {
    if (!HeyGenAvatarStreamingService.instance) {
      console.log("🔧 Creating new HeyGenAvatarStreamingService instance (singleton)");
      HeyGenAvatarStreamingService.instance = new HeyGenAvatarStreamingService();
    } else {
      console.log("🔧 Reusing existing HeyGenAvatarStreamingService instance (singleton)");
    }
    return HeyGenAvatarStreamingService.instance;
  }

  private async getSessionToken(): Promise<string> {
    console.log("🔑 Attempting to get HeyGen session token...");
    console.log("🔑 Using API key:", API_CONFIG.apiKey);
    
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
    
    console.log("🔑 Response status:", response.status);
    const data = await response.json();
    console.log("🔑 Response data:", data);
    
    if (!data.data?.token) {
      console.error("❌ No session token in response:", data);
      throw new Error("Failed to get session token");
    }
    
    console.log("✅ Session token obtained successfully");
    return data.data.token;
  }

  private async startStreamingSession(sessionId: string, sessionToken: string): Promise<boolean> {
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        session_token: sessionToken,
        silence_response: "false",
        stt_language: "en",
      }),
    });
    const data = await response.json();
    return data.code === 100;
  }

  public async createAvatarSession(): Promise<AvatarSessionData | null> {
    if (this.isCreatingSession) {
      console.log("🔄 Avatar session creation already in progress, waiting...");
      // Wait for current creation to complete
      while (this.isCreatingSession) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.currentSession;
    }

    if (this.currentSession) {
      console.log("✅ Using existing avatar session");
      return this.currentSession;
    }

    try {
      this.isCreatingSession = true;
      console.log("Creating new HeyGen avatar session...");
      
      // Get new session token
      const newSessionToken = await this.getSessionToken();

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
        const streamingStarted = await this.startStreamingSession(newAvatarSessionId, newSessionToken);
        
        if (streamingStarted) {
          console.log("✅ Avatar streaming session started successfully");
          
          const sessionData: AvatarSessionData = {
            sessionId: newAvatarSessionId,
            sessionToken: newSessionToken,
            wsUrl: data.data.realtime_endpoint,
            token: data.data.access_token,
            livekitUrl: data.data.url
          };

          console.log("📺 Avatar session URLs:");
          console.log("   HeyGen WebSocket:", data.data.realtime_endpoint);
          console.log("   LiveKit URL:", data.data.url);
          console.log("   Access Token:", data.data.access_token.substring(0, 50) + "...");

          this.currentSession = sessionData;
          
          // Set up WebSocket connection for events
          this.setupWebSocket(data.data.realtime_endpoint);
          
          return sessionData;
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
    } finally {
      this.isCreatingSession = false;
    }
  }

  public getCurrentSession(): AvatarSessionData | null {
    return this.currentSession;
  }

  public setEventHandlers(callbacks: AvatarEventCallbacks): void {
    this.eventCallbacks = callbacks;
  }

  private setupWebSocket(wsUrl: string): void {
    if (!this.currentSession) return;

    // Set up WebSocket connection for HeyGen events
    const params = new URLSearchParams({
      session_id: this.currentSession.sessionId,
      session_token: this.currentSession.sessionToken,
      silence_response: "false",
      stt_language: "en",
    });
    
    console.log('🔌 Attempting to connect to HeyGen WebSocket:', wsUrl);
    console.log('🔌 WebSocket parameters:', { 
      session_id: this.currentSession.sessionId, 
      session_token: this.currentSession.sessionToken 
    });
    
    this.websocket = new WebSocket(wsUrl);
    
    this.websocket.onopen = () => {
      console.log('✅ HeyGen WebSocket connection opened successfully');
    };
    
    // Set up WebSocket message handling for avatar events
    this.websocket.onmessage = (event) => {
      console.log('📥 HeyGen WebSocket raw message received:', event.data);
      try {
        const data = JSON.parse(event.data);
        console.log('📥 HeyGen WebSocket Event message received:', JSON.stringify(data, null, 2));
        
        // Handle agent state changes (primary HeyGen event type)
        if (data.type === 'agent.state') {
          if (data.state === 1) {
            console.log('🗣️ HeyGen Event: Agent state 1 - Avatar started speaking - pausing microphone');
            this.eventCallbacks.onAvatarSpeaking?.();
          } else if (data.state === 0) {
            console.log('✅ HeyGen Event: Agent state 0 - Avatar finished speaking - resuming microphone');
            this.eventCallbacks.onAvatarFinished?.();
          }
        }
        
        // Handle legacy avatar speaking events (fallback)
        if (data.type === 'avatar_speaking' || data.type === 'speech_start' || data.event === 'avatar_speaking') {
          console.log('🗣️ HeyGen Event: Avatar started speaking - pausing microphone');
          this.eventCallbacks.onAvatarSpeaking?.();
        }
        
        // Handle legacy avatar finished speaking events (fallback)
        if (data.type === 'avatar_finished' || data.type === 'speech_end' || data.event === 'avatar_finished') {
          console.log('✅ HeyGen Event: Avatar finished speaking - resuming microphone');
          this.eventCallbacks.onAvatarFinished?.();
        }
        
        // Handle task completion events
        if (data.type === 'task_completed' || data.event === 'task_completed') {
          console.log('✅ HeyGen Event: Task completed - avatar should be finished speaking');
          this.eventCallbacks.onTaskCompleted?.();
        }
        
        // Handle error events
        if (data.type === 'error' || data.event === 'error') {
          console.error('❌ HeyGen WebSocket error:', data.message || data.error);
        }
        
      } catch (error) {
        console.error('❌ Error parsing HeyGen WebSocket message:', error);
        console.error('Raw message:', event.data);
      }
    };
    
    this.websocket.onclose = () => {
      console.log('🔌 HeyGen WebSocket connection closed');
    };
    
    this.websocket.onerror = (error) => {
      console.error('❌ HeyGen WebSocket connection error:', error);
    };
  }

  public async closeSession(): Promise<void> {
    if (!this.currentSession) {
      console.log("No active session to close");
      return;
    }

    try {
      // Close WebSocket connection
      if (this.websocket) {
        this.websocket.close();
        this.websocket = null;
        console.log("🔌 HeyGen WebSocket closed");
      }

      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.currentSession.sessionToken}`,
        },
        body: JSON.stringify({
          session_id: this.currentSession.sessionId,
        }),
      });
      
      console.log("✅ Avatar session closed successfully");
      this.currentSession = null;
    } catch (error) {
      console.error("❌ Error closing avatar session:", error);
    }
  }

  public reset(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.currentSession = null;
    this.isCreatingSession = false;
    this.eventCallbacks = {};
  }
}

export const heyGenAvatarStreamingService = HeyGenAvatarStreamingService.getInstance();
