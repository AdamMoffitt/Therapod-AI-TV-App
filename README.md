# Therapod Wellness TV Webapp

A React Native Expo app for Android TV that provides AI-powered wellness therapy sessions with voice interaction capabilities.

## Features

- AI-powered therapy sessions with voice interaction
- Always-on microphone listening for natural conversation
- Android TV optimized interface
- Real-time speech recognition
- Avatar-based therapy sessions

## Android TV Microphone Support

This app has been specifically optimized for Android TV microphone functionality. Key features include:

### Microphone Configuration
- **Android TV specific audio mode** - Optimized for TV audio routing
- **Continuous speech recognition** - Always-on listening capability
- **Cloud-based recognition** - Better reliability on TV devices
- **Automatic retry mechanisms** - Handles connection issues gracefully

### Troubleshooting Android TV Microphone Issues

If you're experiencing microphone issues on Android TV:

1. **Check Permissions**
   - Go to TV Settings > Apps > Therapod AI Wellness > Permissions
   - Enable Microphone and Speech Recognition permissions
   - Enable Bluetooth permissions if using external microphone

2. **Audio Configuration**
   - Connect external microphone for better quality
   - Check TV audio settings for microphone input
   - Ensure stable WiFi connection (minimum 5Mbps)

3. **Common Solutions**
   - Restart the app completely
   - Clear app cache (Settings > Apps > Therapod > Storage > Clear cache)
   - Check for Android TV system updates
   - Verify network connection is stable

4. **Advanced Debugging**
   - Use the built-in microphone test function
   - Check console logs for detailed error messages
   - Verify Bluetooth is enabled for external microphones

### Technical Details

The app uses the following Android TV specific configurations:

```typescript
// Audio mode for Android TV
await Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: false,
  staysActiveInBackground: true,
  shouldDuckAndroid: false,
  playThroughEarpieceAndroid: false,
});

// Speech recognition for Android TV
const config = {
  lang: 'en-US',
  interimResults: true,
  continuous: true,
  maxAlternatives: 3,
  requiresOnDeviceRecognition: false,
  partialResults: true,
};
```

## Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Run on Android TV: `npx expo run:android`

## Development

- **Platform**: React Native with Expo
- **Target**: Android TV
- **Voice**: expo-speech-recognition
- **Audio**: expo-av
- **AI**: HeyGen API integration

## Support

For microphone issues on Android TV, please refer to the [Microphone Setup Guide](docs/MICROPHONE_SETUP.md) for detailed troubleshooting steps.
