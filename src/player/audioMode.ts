/**
 * Configure background audio mode and lockscreen support.
 * Handled directly by expo-video's player.staysActiveInBackground = true and showNowPlayingNotification = true
 */
export const configureBackgroundAudio = async (): Promise<void> => {
  // In modern Expo SDK (expo-video), background playback is natively enabled 
  // via player configuration flags (staysActiveInBackground & showNowPlayingNotification).
};
