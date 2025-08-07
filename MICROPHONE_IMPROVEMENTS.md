# Microphone Improvements for TV App Echo Prevention

## Problem Summary

The TV app was experiencing microphone feedback issues where:
1. **Echo Loop**: The microphone picked up the AI avatar's speech from the speakers, causing the AI to talk to itself
2. **No User Input**: Sometimes the microphone wouldn't pick up user speech at all
3. **Timing Issues**: The microphone would restart too quickly after the avatar finished speaking

## Solutions Implemented

### 1. Enhanced Audio Configuration

**File**: `components/Guide.tsx`

**Changes**:
- Added TV-specific audio mode settings
- Enabled audio ducking to reduce interference
- Added interruption mode settings to prevent audio conflicts
- Increased delays for better audio setup

```typescript
await Audio.setAudioModeAsync({
  allowsRecordingIOS: true,
  playsInSilentModeIOS: true,
  staysActiveInBackground: true,
  shouldDuckAndroid: true, // Duck other audio when recording
  playThroughEarpieceAndroid: false, // Use speakers for TV
  // Additional TV-specific settings
  interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
  interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
});
```

### 2. Echo Prevention System

**New State Variables**:
```typescript
const [lastAvatarSpeechEnd, setLastAvatarSpeechEnd] = useState<number>(0);
const [micCooldownPeriod, setMicCooldownPeriod] = useState(2000); // 2 seconds cooldown
const [echoDetectionThreshold, setEchoDetectionThreshold] = useState(0.4);
const [isInEchoCooldown, setIsInEchoCooldown] = useState(false);
```

**Echo Prevention Features**:
- **Cooldown Period**: 2-second delay after avatar speech before resuming microphone
- **Audio Level Detection**: Monitors audio levels to detect potential echo
- **Speech Pattern Detection**: Identifies common avatar speech patterns
- **Confidence Threshold**: Filters out low-confidence speech that might be echo

### 3. Enhanced WebSocket Message Handling

**Improved Avatar Speaking Detection**:
- Better handling of `avatar_speaking`, `avatar_finished`, and `task_completed` events
- Immediate microphone pause when avatar starts speaking
- Cooldown period after avatar finishes speaking
- Enhanced error handling and recovery

### 4. Improved Speech Recognition Timing

**Changes**:
- Increased delays between speech recognition restarts
- Better coordination between avatar speech and microphone resumption
- Enhanced error recovery with longer delays
- More robust health checks for always-on listening

### 5. Audio Level Monitoring

**Enhanced Features**:
- Real-time audio level monitoring
- Automatic echo detection based on audio levels
- Smart microphone resumption based on audio activity
- Better filtering of background noise

## Testing the Improvements

### 1. Use the Microphone Test Component

I've created a test component (`components/MicrophoneTestComponent.tsx`) that you can use to verify the improvements:

```typescript
// Add this to your Guide component temporarily for testing
import MicrophoneTestComponent from './MicrophoneTestComponent';

// Add state for showing test component
const [showMicrophoneTest, setShowMicrophoneTest] = useState(false);

// Add button to show test component
<TouchableOpacity onPress={() => setShowMicrophoneTest(true)}>
  <Text>Test Microphone</Text>
</TouchableOpacity>

// Add test component
{showMicrophoneTest && (
  <MicrophoneTestComponent onClose={() => setShowMicrophoneTest(false)} />
)}
```

### 2. Manual Testing Steps

1. **Start a therapy session**
2. **Set conversation mode to "Always On"**
3. **Test echo prevention**:
   - Speak to the AI
   - When the AI responds, speak again immediately
   - The microphone should pause during AI speech and resume after a 2-second cooldown
4. **Test continuous listening**:
   - Speak naturally without pressing buttons
   - The microphone should stay active and respond to your voice
5. **Test error recovery**:
   - If the microphone stops working, it should automatically restart

### 3. Expected Behavior

**Before Improvements**:
- ❌ Microphone picks up AI speech (echo)
- ❌ AI talks to itself in loops
- ❌ Microphone doesn't hear user input
- ❌ Timing issues with microphone restart

**After Improvements**:
- ✅ Microphone pauses during AI speech
- ✅ 2-second cooldown prevents echo
- ✅ Better user input detection
- ✅ Reliable microphone restart timing
- ✅ Enhanced error recovery

## Configuration Options

You can adjust these settings in `components/Guide.tsx`:

```typescript
// Echo prevention settings
const [micCooldownPeriod, setMicCooldownPeriod] = useState(2000); // 2 seconds
const [echoDetectionThreshold, setEchoDetectionThreshold] = useState(0.4); // 40% audio level

// Timing settings
const maxSpeakingTime = 45000; // 45 seconds max avatar speech
const healthCheckInterval = 15000; // 15 seconds health check
```

## Troubleshooting

### If Echo Still Occurs

1. **Increase cooldown period**:
   ```typescript
   const [micCooldownPeriod, setMicCooldownPeriod] = useState(3000); // 3 seconds
   ```

2. **Lower echo detection threshold**:
   ```typescript
   const [echoDetectionThreshold, setEchoDetectionThreshold] = useState(0.3); // 30%
   ```

3. **Check audio levels** in the test component to see if the threshold needs adjustment

### If Microphone Doesn't Hear User Input

1. **Check permissions** using the test component
2. **Verify audio configuration** is working
3. **Test with external microphone** if available
4. **Check TV audio settings** for microphone input

### If Microphone Cuts Out

1. **Increase health check frequency**:
   ```typescript
   }, 10000); // 10 seconds instead of 15
   ```

2. **Check error logs** for specific issues
3. **Verify network connection** is stable

## Performance Considerations

- **Cooldown periods** add slight delays but prevent echo
- **Audio level monitoring** uses minimal CPU
- **Health checks** run every 15 seconds to ensure reliability
- **Enhanced error recovery** improves stability

## Future Improvements

1. **Adaptive cooldown periods** based on room acoustics
2. **Machine learning echo detection** for better accuracy
3. **Audio processing** to filter out specific frequencies
4. **User calibration** for different TV setups

## Files Modified

1. `components/Guide.tsx` - Main microphone logic improvements
2. `components/MicrophoneTestComponent.tsx` - New test component
3. `MICROPHONE_IMPROVEMENTS.md` - This documentation

## Testing Checklist

- [ ] Microphone permissions granted
- [ ] Audio configuration working
- [ ] Echo prevention active during AI speech
- [ ] 2-second cooldown working after AI speech
- [ ] Continuous listening working
- [ ] Error recovery working
- [ ] Audio level monitoring active
- [ ] Health checks running
- [ ] WebSocket events handling correctly

## Support

If you continue to experience issues:
1. Use the microphone test component to diagnose problems
2. Check the console logs for error messages
3. Adjust the configuration settings as needed
4. Test with different audio setups 