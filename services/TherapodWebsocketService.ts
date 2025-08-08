// Client-side WebSocket Service for maintaining persistent connections to the backend
// This service runs in the browser and maintains a single connection across all API calls

interface MessageHandler {
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
  messageId: string;
  responseData: string;
  timeout: NodeJS.Timeout;
}

interface QueuedMessage {
  messageData: any;
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
}

class TherapodWebSocketService {
  private static instance: TherapodWebSocketService;
  private ws: WebSocket | null = null;
  private connectionPromise: Promise<WebSocket> | null = null;
  private activeMessageHandler: MessageHandler | null = null;
  private messageQueue: QueuedMessage[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private isConnecting = false;
  private connectionTimeout = 10000; // 10 seconds
  private messageTimeout = 30000; // 30 seconds
  private isShuttingDown = false;
  private lastActivityTime = 0; // Track last activity
  private connectionCount = 0; // Track total connections made
  private instanceId = Math.random().toString(36).substr(2, 9); // Unique instance ID

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): TherapodWebSocketService {
    if (!TherapodWebSocketService.instance) {
      console.log("🔧 Creating new TherapodWebSocketService instance (singleton)");
      TherapodWebSocketService.instance = new TherapodWebSocketService();
    } else {
      console.log(`🔧 Reusing existing TherapodWebSocketService instance (singleton) [Instance: ${TherapodWebSocketService.instance.instanceId}]`);
    }
    return TherapodWebSocketService.instance;
  }

  private async createConnection(): Promise<WebSocket> {
    console.log("🔌 createConnection called - isConnecting:", this.isConnecting, "connectionPromise:", !!this.connectionPromise);
    
    if (this.isConnecting) {
      // Wait for existing connection attempt
      if (this.connectionPromise) {
        console.log("🔌 Waiting for existing connection attempt...");
        return this.connectionPromise;
      }
    }

    this.isConnecting = true;
    
    return new Promise<WebSocket>((resolve, reject) => {
      this.connectionCount++;
      console.log(`🔌 [Instance: ${this.instanceId}] Creating new WebSocket connection #${this.connectionCount} to backend...`);
      
      const ws = new WebSocket("wss://api.therapodai.com/ws/chat");
      
      const connectionTimeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new Error('WebSocket connection timeout'));
        ws.close();
      }, this.connectionTimeout);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log("✅ WebSocket connected successfully to backend");
        this.ws = ws;
        this.connectionPromise = null;
        this.isConnecting = false;
        this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        this.reconnectDelay = 1000; // Reset reconnect delay
        
        // Process any queued messages
        this.processMessageQueue();
        
        resolve(ws);
      };

      ws.onmessage = (event) => {
        if (this.activeMessageHandler) {
          // Accumulate response data from multiple chunks
          this.activeMessageHandler.responseData += event.data + '\n';

          // Reset the timeout for this message (backend is still responding)
          clearTimeout(this.activeMessageHandler.timeout);
          this.activeMessageHandler.timeout = setTimeout(() => {
            console.log("Message response complete (timeout reached)");
            const handler = this.activeMessageHandler;
            this.activeMessageHandler = null;
            if (handler) {
              handler.resolve(handler.responseData.trim());
            }
            // Process next message in queue
            this.processNextMessage();
          }, 5000); // 5 second timeout for each chunk
        }
      };

      ws.onclose = (event) => {
        console.log("🔌 WebSocket connection closed:", event.code, event.reason);
        this.ws = null;
        this.connectionPromise = null;
        this.isConnecting = false;

        // Clear active message handler
        if (this.activeMessageHandler) {
          clearTimeout(this.activeMessageHandler.timeout);
          this.activeMessageHandler.reject(new Error('WebSocket connection closed'));
          this.activeMessageHandler = null;
        }

        // Attempt to reconnect if not shutting down
        if (!this.isShuttingDown && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = (error) => {
        console.error("❌ WebSocket connection error:", error);
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        reject(error);
      };
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    console.log(`🔄 Scheduling WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
    
    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.connectionPromise = this.createConnection();
      }
    }, this.reconnectDelay);
    
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private async getConnection(): Promise<WebSocket> {
    console.log("🔌 getConnection called - ws state:", this.ws?.readyState, "connectionPromise:", !!this.connectionPromise);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    console.log("🔌 Creating new connection promise");
    this.connectionPromise = this.createConnection();
    return this.connectionPromise;
  }

  private processMessageQueue(): void {
    console.log("📋 Processing message queue, length:", this.messageQueue.length);
    this.processNextMessage();
  }

  private processNextMessage(): void {
    if (this.messageQueue.length > 0 && !this.activeMessageHandler) {
      const queuedMessage = this.messageQueue.shift()!;
      console.log("📋 Processing queued message");
      this.sendMessageInternal(queuedMessage.messageData, queuedMessage.resolve, queuedMessage.reject);
    }
  }

  private sendMessageInternal(messageData: any, resolve: (value: string) => void, reject: (reason?: any) => void): void {
    const messageId = Math.random().toString(36).substr(2, 9);
    
    this.activeMessageHandler = {
      resolve,
      reject: (reason?: any) => {
        console.log("❌ Message rejected:", reason);
        this.activeMessageHandler = null;
        reject(reason);
      },
      messageId,
      responseData: '',
      timeout: setTimeout(() => {
        console.log("Message response timeout after 30 seconds");
        const handler = this.activeMessageHandler;
        this.activeMessageHandler = null;
        if (handler) {
          handler.reject(new Error('Message response timeout'));
        }
        // Process next message in queue
        this.processNextMessage();
      }, this.messageTimeout)
    };

    // Send the message
    if (this.ws) {
      console.log("📤 Sending message via WebSocket");
      this.ws.send(JSON.stringify(messageData));
    } else {
      reject(new Error('WebSocket not connected'));
    }
  }

  public async sendMessage(messageData: any): Promise<string> {
    console.log("📤 sendMessage called - activeMessageHandler:", !!this.activeMessageHandler, "queueLength:", this.messageQueue.length);
    
    try {
      const ws = await this.getConnection();
      
      return new Promise<string>((resolve, reject) => {
        // If there's already an active message handler, queue this message
        if (this.activeMessageHandler) {
          console.log("📋 Queuing message - another message is being processed");
          this.messageQueue.push({
            messageData,
            resolve,
            reject
          });
          return;
        }

        this.sendMessageInternal(messageData, resolve, reject);
      });
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public getConnectionStatus(): {
    connected: boolean;
    connecting: boolean;
    queueLength: number;
    activeMessage: boolean;
    connectionCount: number;
  } {
    return {
      connected: this.isConnected(),
      connecting: this.isConnecting,
      queueLength: this.messageQueue.length,
      activeMessage: this.activeMessageHandler !== null,
      connectionCount: this.connectionCount
    };
  }

  public close(): void {
    console.log("🔌 Closing TherapodWebSocketService service");
    this.isShuttingDown = true;
    if (this.activeMessageHandler) {
      clearTimeout(this.activeMessageHandler.timeout);
      this.activeMessageHandler = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionPromise = null;
    this.messageQueue = [];
  }
}

// Helper functions for session management
const getUserId = () => {
  return 'user-' + Date.now();
};

const getTherapistId = () => {
  return 'therapist-1';
};

const getTherapodSessionId = () => {
  return 'session-' + Date.now();
};

const fetchWelcomeMessage = async () => {
  try {
    const userId = getUserId();
    const therapistId = getTherapistId();
    const sessionId = getTherapodSessionId();
    console.log(
      "🔍 Fetching welcome message for user:",
      userId,
      "therapist:",
      therapistId,
      "session:",
      sessionId
    );

    const response = await fetch(
      "https://api.therapodai.com/welcome-message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          therapist_id: therapistId,
          session_id: sessionId,
        }),
      }
    );

    console.log("📥 Welcome message API response:", {
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    console.log("✅ Welcome message received:", data.welcome_message);
    return data.welcome_message;
  } catch (error) {
    console.error("❌ Error fetching welcome message:", error);
    const fallbackMessage =
      "Welcome! I'm your AI therapy assistant. I'm here to listen and support you. Our session will last for 30 minutes. How are you feeling today?";
    console.log("📝 Using fallback welcome message:", fallbackMessage);
    return fallbackMessage;
  }
};

const fetchEndingMessage = async () => {
  try {
    const userId = getUserId();
    const therapistId = getTherapistId();
    const sessionId = getTherapodSessionId();
    console.log(
      "🔍 Fetching ending message for user:",
      userId,
      "therapist:",
      therapistId,
      "session:",
      sessionId
    );

    const response = await fetch(
      "https://api.therapodai.com/ending-message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          therapist_id: therapistId,
          session_id: sessionId,
        }),
      }
    );

    console.log("📥 Ending message API response:", {
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    console.log("✅ Ending message received:", data.ending_message);
    return data.ending_message;
  } catch (error) {
    console.error("❌ Error fetching ending message:", error);
    const fallbackMessage =
      "Thank you for sharing your thoughts with me today. I hope our conversation was helpful. Remember to take care of yourself, and I'll be here whenever you need to talk again. Take care and have a wonderful day!";
    console.log("📝 Using fallback ending message:", fallbackMessage);
    return fallbackMessage;
  }
};

const generateSummary = async (messages: any[]) => {
  if (messages.length === 0) return;
  try {
    // Get sessionId from URL parameters
    const currentSessionId = getTherapodSessionId();
    const therapistId = getTherapistId();
    console.log(
      "🔍 Generating summary with sessionId from URL:",
      currentSessionId,
      "therapist:",
      therapistId
    );

    const response = await fetch(
      `https://api.therapodai.com/generate-summary`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          session_id: currentSessionId,
          user_id: getUserId(),
          therapist_id: therapistId,
        }),
      }
    );
    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.log("Session summary generate error : ", error);
    throw error;
  }
};

// Export singleton instance and helper functions
export const therapodWebSocketService = TherapodWebSocketService.getInstance();
export { fetchWelcomeMessage, fetchEndingMessage, generateSummary };
