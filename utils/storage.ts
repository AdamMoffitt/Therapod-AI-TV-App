import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV();

export const saveSelectedPod = (podId: string) => {
  storage.set('selectedPodId', podId);
};

export const getSelectedPod = (): string | undefined => {
  return storage.getString('selectedPodId') || undefined;
};
