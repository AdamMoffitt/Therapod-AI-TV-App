import { NativeModules } from 'react-native';

interface AudioControlInterface {
  muteMicrophone(): Promise<boolean>;
  unmuteMicrophone(): Promise<boolean>;
  setSystemVolume(volume: number): Promise<boolean>;
  getSystemVolume(): Promise<number>;
  isSystemMuted(): Promise<boolean>;
}

const { AudioControl } = NativeModules;

export default AudioControl as AudioControlInterface;
