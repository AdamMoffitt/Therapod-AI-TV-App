const API_CONFIG = {
  serverUrl: "https://api.heygen.com",
  apiKey: process.env.EXPO_PUBLIC_HEYGEN_API_KEY || "EXPO_PUBLIC_HEYGEN_API_KEY=NDNmMDRlZDRlYjI3NDVjNjk3ODU3ZDVmZGMyNjk1OGItMTc1NDE0MjEyMQ==",
};

export const HEYGEN_CONFIG = {
  apiKey: API_CONFIG.apiKey,
  serverUrl: API_CONFIG.serverUrl,
  defaultAvatar: "default_avatar_id", // Replace with your default avatar ID
  quality: "high" as const,
  version: "v2" as const,
  videoEncoding: "H264" as const,
  sttLanguage: "en" as const,
  silenceResponse: "false" as const,
};

export const validateHeyGenConfig = (): boolean => {
  if (!HEYGEN_CONFIG.apiKey || HEYGEN_CONFIG.apiKey === "EXPO_PUBLIC_HEYGEN_API_KEY=NDNmMDRlZDRlYjI3NDVjNjk3ODU3ZDVmZGMyNjk1OGItMTc1NDE0MjEyMQ==") {
    console.error("HeyGen API key is not configured");
    return false;
  }
  return true;
};

export const getSessionToken = async (): Promise<string> => {
  const response = await fetch(
    `${HEYGEN_CONFIG.serverUrl}/v1/streaming.create_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HEYGEN_CONFIG.apiKey}`,
      },
    }
  );
  const data = await response.json();
  if (!data.data?.session_token) {
    throw new Error("Failed to get session token");
  }
  return data.data.session_token;
};

export const createNewSession = async (sessionToken: string) => {
  const response = await fetch(`${HEYGEN_CONFIG.serverUrl}/v1/streaming.new`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      quality: HEYGEN_CONFIG.quality,
      version: HEYGEN_CONFIG.version,
      video_encoding: HEYGEN_CONFIG.videoEncoding,
    }),
  });
  const data = await response.json();
  if (!data.data) {
    throw new Error("Failed to create new session");
  }
  return data.data;
};

export const startStreamingSession = async (
  sessionId: string,
  sessionToken: string
) => {
  const response = await fetch(`${HEYGEN_CONFIG.serverUrl}/v1/streaming.start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      session_id: sessionId,
      session_token: sessionToken,
      silence_response: HEYGEN_CONFIG.silenceResponse,
      stt_language: HEYGEN_CONFIG.sttLanguage,
    }),
  });
  const data = await response.json();
  if (!data.data) {
    throw new Error("Failed to start streaming session");
  }
  return data.data;
};

export const sendText = async (
  sessionId: string,
  sessionToken: string,
  text: string
) => {
  const response = await fetch(`${HEYGEN_CONFIG.serverUrl}/v1/streaming.task`, {
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
  return data;
};

export const closeSession = async (
  sessionId: string,
  sessionToken: string
) => {
  const response = await fetch(`${HEYGEN_CONFIG.serverUrl}/v1/streaming.stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
  return response.json();
};