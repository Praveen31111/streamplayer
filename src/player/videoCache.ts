import {
  setVideoCacheSizeAsync,
  clearVideoCacheAsync,
  getCurrentVideoCacheSize,
} from 'expo-video';



/**
 * Initialize high-speed dedicated video chunk disk cache
 */
export const initVideoCache = async (maxSizeMB: number = 500): Promise<void> => {
  try {
    const bytes = maxSizeMB * 1024 * 1024;
    await setVideoCacheSizeAsync(bytes);
    console.log(`[VideoCache] Allocated ${maxSizeMB}MB disk cache for lag-free streaming.`);
  } catch (error) {
    console.warn('[VideoCache] Could not set custom video cache size:', error);
  }
};

/**
 * Get current cached video bytes
 */
export const getCachedVideoSizeBytes = (): number => {
  try {
    return getCurrentVideoCacheSize();
  } catch {
    return 0;
  }
};

/**
 * Wipe temporary cached video chunks
 */
export const clearVideoCache = async (): Promise<void> => {
  try {
    await clearVideoCacheAsync();
    console.log('[VideoCache] Video cache cleared successfully.');
  } catch (error) {
    console.warn('[VideoCache] Error clearing video cache:', error);
  }
};
