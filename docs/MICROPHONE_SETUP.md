# Perfect Microphone Setup Guide for TV App

This guide ensures your microphone works continuously and perfectly in the Therapod Wellness TV App. Since this is a TV application that stays in the foreground, the setup is much simpler than mobile apps.

## Android TV Setup

### 1. App Permissions
1. Go to **TV Settings** > **Apps** > **Therapod AI Wellness**
2. Tap **Permissions**
3. Enable **Microphone** and **Speech Recognition**
4. Enable **Bluetooth** (if using external microphone)
5. Set **Background app refresh** to **Allow**

### 2. TV-Specific Settings
Since this is a TV app that stays in the foreground:
1. **No battery optimization needed** - TV apps don't get killed in background
2. **No background service needed** - App stays active
3. **Simplified setup** - Just ensure microphone permissions are granted

### 3. Audio Device Configuration
1. **Connect external microphone** if needed for better quality
2. **Check TV audio settings** - Ensure microphone input is enabled
3. **Test microphone levels** - Adjust volume in TV settings if needed
4. **Check Bluetooth settings** - Ensure Bluetooth is enabled for external mics

## Android TV Troubleshooting

### Common Android TV Microphone Issues

#### 1. Microphone Not Detected
- **Check TV microphone input** in audio settings
- **Restart the TV app** if microphone stops working
- **Verify network connection** is stable
- **Check external microphone** if using one
- **Ensure Bluetooth is enabled** for external mics

#### 2. Speech Recognition Not Working
- **Check internet connection** - Speech recognition requires cloud service
- **Verify permissions** are still granted
- **Restart the app** completely
- **Clear app cache** (Settings > Apps > Therapod > Storage > Clear cache)
- **Check for system updates**

#### 3. Audio Quality Issues
- **Connect external microphone** for better quality
- **Adjust TV microphone sensitivity** if available
- **Check for audio interference** from other devices
- **Ensure stable WiFi connection** for voice processing

#### 4. App Stops Listening
- **Tap "Resume Mic" button** in the app
- **Restart the session**
- **Check internet connection**
- **Verify permissions are still granted**
- **Force stop and restart the app**

### Android TV Specific Solutions

#### 1. Hardware Microphone Issues
```bash
# Check if microphone is detected
adb shell dumpsys audio | grep -i microphone

# Check audio permissions
adb shell dumpsys package com.TherapodWellnessTvApp.app | grep -i permission
```

#### 2. Software Configuration Issues
- **Update Android TV** to latest version
- **Clear app data** and reinstall
- **Check developer options** for audio settings
- **Verify HDMI audio settings** if using external audio

#### 3. Network Issues
- **Use stable WiFi** connection (minimum 5Mbps)
- **Avoid mobile data** if possible
- **Check for network interference**
- **Test with different network** if available

## Verification Steps

### Check Microphone Activity
- **TV App**: Look for the microphone indicator in the app interface
- **Audio Level**: The audio level bar should show activity when speaking
- **Status Text**: Should display "Always Listening..." when active

### Test Always-On Listening
1. Start a therapy session
2. Set conversation mode to "Always On"
3. Speak naturally without pressing any buttons
4. The app should respond automatically
5. The microphone should stay active continuously
6. No need to worry about background/foreground switching

## Advanced Settings

### For TV Power Users
- **Use dedicated TV** for therapy sessions
- **Connect high-quality external microphone** for better audio
- **Ensure stable power connection** to TV
- **Close other apps** on TV if needed

### Network Considerations
- **Use stable WiFi** connection
- **Avoid mobile data** if possible
- **Check for network interference**

## Support

If you continue to experience issues:
1. Check the app logs for error messages
2. Restart your device
3. Reinstall the app
4. Contact support with specific error details

## Technical Notes

The app uses optimized audio services for TV applications:
- **Continuous speech recognition**
- **Foreground audio session management**
- **Automatic retry mechanisms**
- **Simplified architecture** (no background services needed)
- **TV-optimized audio configuration**

These features ensure your microphone stays active continuously since the TV app remains in the foreground.

## Android TV Specific Configuration

### Audio Mode Configuration
The app automatically configures the optimal audio mode for Android TV:
- **allowsRecordingIOS**: false (not applicable for Android)
- **playsInSilentModeIOS**: false (not applicable for Android)
- **staysActiveInBackground**: true (keeps audio active)
- **shouldDuckAndroid**: false (prevents audio ducking)
- **playThroughEarpieceAndroid**: false (uses speaker output)

### Speech Recognition Configuration
Android TV uses cloud-based speech recognition for better reliability:
- **lang**: 'en-US'
- **interimResults**: true
- **continuous**: true
- **maxAlternatives**: 3
- **requiresOnDeviceRecognition**: false (uses cloud)
- **partialResults**: true

### Permission Requirements
Android TV requires these permissions for microphone functionality:
- `android.permission.RECORD_AUDIO`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android.permission.BLUETOOTH` (for external mics)
- `android.permission.BLUETOOTH_CONNECT` (for external mics)
- `android.permission.BLUETOOTH_SCAN` (for external mics) 