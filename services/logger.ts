import { logEvent } from 'firebase/analytics';
import { analytics } from '@/firebase';
import { Platform } from 'react-native';

// Log levels
export const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
};

export const logger = {
  /**
   * Log a debug message
   * @param {string} message - Log message
   * @param {Object} params - Additional parameters
   */
  debug: (message, params = {}) => {
    console.debug(`[DEBUG] ${message}`, params);
    logEvent(analytics, 'debug_log', {
      message,
      ...params,
      timestamp: Date.now(),
    });
  },

  /**
   * Log an info message
   * @param {string} message - Log message
   * @param {Object} params - Additional parameters
   */
  info: (message, params = {}) => {
    console.info(`[INFO] ${message}`, params);
    logEvent(analytics, 'info_log', {
      message,
      ...params,
      timestamp: Date.now(),
    });
  },

  /**
   * Log a warning message
   * @param {string} message - Log message
   * @param {Object} params - Additional parameters
   */
  warn: (message, params = {}) => {
    console.warn(`[WARNING] ${message}`, params);
    logEvent(analytics, 'warning_log', {
      message,
      ...params,
      timestamp: Date.now(),
    });
  },

  /**
   * Log an error message
   * @param {string} message - Log message
   * @param {Object} params - Additional parameters
   */
  error: (message, params = {}) => {
    console.error(`[ERROR] ${message}`, params);
    logEvent(analytics, 'error_log', {
      message,
      ...params,
      timestamp: Date.now(),
      stack: new Error().stack,
    });
  },

  /**
   * Log a user action/event
   * @param {string} eventName - Name of the event
   * @param {Object} params - Event parameters
   */
  event: (eventName, params = {}) => {
    logEvent(analytics, eventName, {
      ...params,
      timestamp: Date.now(),
    });
  },
};

export const logVideoPlayback = (status: string, details = {}) => {
  // Add device information
  const deviceInfo = {
    platform: Platform.OS,
    isTV: Platform.isTV,
    version: Platform.Version,
    ...details
  };
  
  logEvent(analytics, 'video_playback', {
    status,
    ...deviceInfo,
    timestamp: Date.now(),
  });
  
  // Also log to console for debugging
  console.log(`[VIDEO] ${status}`, deviceInfo);
};