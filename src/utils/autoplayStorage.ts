import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTOPLAY_STORAGE_KEY = '@streamplayer_autoplay_enabled';

/**
 * Get the saved autoplay preference.
 * Defaults to false so user has explicit control over automatic next video playback.
 */
export const getAutoplaySetting = async (): Promise<boolean> => {
  try {
    const val = await AsyncStorage.getItem(AUTOPLAY_STORAGE_KEY);
    return val === 'true';
  } catch {
    return false;
  }
};

/**
 * Save user autoplay preference to AsyncStorage.
 */
export const setAutoplaySetting = async (enabled: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(AUTOPLAY_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.warn('Failed to save autoplay setting:', e);
  }
};
