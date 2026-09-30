import { AppState, AppStateStatus } from 'react-native';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import { extractPlayableStream } from '../api';

interface VideoMeta {
  title?: string;
  author?: string;
  thumbnail?: string;
}

// 0.1s valid 8000Hz 16-bit PCM silent WAV - zero CPU overhead, loops seamlessly
const SILENT_WAV_BASE64 =
  'UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

class NativeBackgroundAudioBridge {
  private activeVideoId: string | null = null;
  private lastReportedTime: number = 0;
  private isWebViewPlaying: boolean = false;
  private audioStreamUrl: string | null = null;
  private player: VideoPlayer | null = null;
  private focusKeeperPlayer: VideoPlayer | null = null;
  private silentUri: string | null = null;
  private activeMeta: VideoMeta = {};
  private isPrewarming: boolean = false;
  private wasPlayingInBackground: boolean = false;
  private appStateSubscription: any = null;
  private injectResumeCallback: ((timeSec: number) => void) | null = null;

  constructor() {
    this.initSilentFile();
    this.initAppStateListener();
  }

  private async initSilentFile() {
    try {
      const targetUri = `${FileSystem.cacheDirectory}audio_keeper.wav`;
      const fileInfo = await FileSystem.getInfoAsync(targetUri);
      if (!fileInfo.exists) {
        await FileSystem.writeAsStringAsync(targetUri, SILENT_WAV_BASE64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      this.silentUri = targetUri;
      this.setupFocusKeeper();
    } catch (err) {
      console.warn('[BackgroundAudioBridge] Init silent file error:', err);
    }
  }

  /**
   * Focus Keeper: Android treats the process as FOREGROUND_MEDIA with AUDIO_ACTIVE.
   * This prevents Android OS AudioFlinger from suspending the WebView audio on screen-off.
   */
  private setupFocusKeeper() {
    if (!this.silentUri) return;
    try {
      if (!this.focusKeeperPlayer) {
        this.focusKeeperPlayer = createVideoPlayer({
          uri: this.silentUri,
          metadata: {
            title: this.activeMeta.title || 'Playing Audio',
            artist: this.activeMeta.author || 'YouTube',
            artwork: this.activeMeta.thumbnail,
          },
        });
        this.focusKeeperPlayer.loop = true;
        this.focusKeeperPlayer.staysActiveInBackground = true;
        this.focusKeeperPlayer.showNowPlayingNotification = true;
        this.focusKeeperPlayer.audioMixingMode = 'mixWithOthers';
        this.focusKeeperPlayer.volume = 0.001; // virtually silent, holds Android audio focus
      }
    } catch (err) {
      console.warn('[BackgroundAudioBridge] Setup focus keeper error:', err);
    }
  }

  public setResumeCallback(cb: (timeSec: number) => void) {
    this.injectResumeCallback = cb;
  }

  private initAppStateListener() {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        this.onAppStateChange(nextState);
      }
    );
  }

  /**
   * Called from WebView message stream whenever YouTube updates time or play/pause
   */
  public updatePlaybackState(
    videoId: string,
    currentTime: number,
    isPlaying: boolean,
    meta?: VideoMeta
  ) {
    if (!videoId) return;

    this.lastReportedTime = currentTime;
    this.isWebViewPlaying = isPlaying;

    if (meta) {
      this.activeMeta = {
        title: meta.title || this.activeMeta.title,
        author: meta.author || this.activeMeta.author,
        thumbnail: meta.thumbnail || this.activeMeta.thumbnail,
      };
    }

    // Sync native Audio Focus Keeper with video play/pause
    if (this.focusKeeperPlayer) {
      if (isPlaying) {
        try {
          this.focusKeeperPlayer.play();
        } catch {}
      } else {
        try {
          this.focusKeeperPlayer.pause();
        } catch {}
      }
    }

    // Video changed: pre-warm fallback audio stream in background
    if (this.activeVideoId !== videoId) {
      this.activeVideoId = videoId;
      this.audioStreamUrl = null;
      void this.prewarmAudioStream(videoId);
    }
  }

  /**
   * Asynchronously extracts direct audio stream URL for native ExoPlayer fallback
   */
  private async prewarmAudioStream(videoId: string): Promise<void> {
    if (this.isPrewarming) return;
    this.isPrewarming = true;

    try {
      const stream = await extractPlayableStream(videoId);
      const audioUrl = stream?.audioStreamUrl || stream?.streamUrl;

      if (audioUrl && this.activeVideoId === videoId) {
        this.audioStreamUrl = audioUrl;
        this.setupNativePlayer(audioUrl);
      }
    } catch (err) {
      console.warn('[BackgroundAudioBridge] Pre-warm stream failed:', err);
    } finally {
      this.isPrewarming = false;
    }
  }

  private setupNativePlayer(url: string) {
    try {
      if (this.player) {
        try {
          this.player.pause();
          this.player.replaceAsync({
            uri: url,
            metadata: {
              title: this.activeMeta.title || 'Playing Audio',
              artist: this.activeMeta.author || 'YouTube',
              artwork: this.activeMeta.thumbnail,
            },
          });
        } catch {
          this.player = null;
        }
      }

      if (!this.player) {
        this.player = createVideoPlayer({
          uri: url,
          metadata: {
            title: this.activeMeta.title || 'Playing Audio',
            artist: this.activeMeta.author || 'YouTube',
            artwork: this.activeMeta.thumbnail,
          },
        });
      }

      if (this.player) {
        this.player.staysActiveInBackground = true;
        this.player.showNowPlayingNotification = true;
        this.player.audioMixingMode = 'auto';
        this.player.pause();
      }
    } catch (err) {
      console.warn('[BackgroundAudioBridge] Setup native player error:', err);
    }
  }

  /**
   * Handle transitions between Foreground (WebView) and Background (Screen OFF / Locked)
   */
  private onAppStateChange(nextState: AppStateStatus) {
    if (nextState === 'background' || nextState === 'inactive') {
      // Keep focus keeper actively holding AudioFocus
      if (this.isWebViewPlaying && this.focusKeeperPlayer) {
        try {
          this.focusKeeperPlayer.play();
        } catch {}
      }

      // If native player with extracted stream is ready, play it as fallback
      if (this.isWebViewPlaying && this.audioStreamUrl && this.player) {
        try {
          const seekPos = Math.max(0, this.lastReportedTime);
          this.player.currentTime = seekPos;
          this.player.play();
          this.wasPlayingInBackground = true;
        } catch (err) {
          console.warn('[BackgroundAudioBridge] Failed to start native audio playback:', err);
        }
      }
    } else if (nextState === 'active') {
      // Screen Turned Back ON
      if (this.wasPlayingInBackground && this.player) {
        try {
          const currentAudioTime = this.player.currentTime;
          this.player.pause();
          this.wasPlayingInBackground = false;

          if (this.injectResumeCallback && currentAudioTime > 0) {
            this.injectResumeCallback(currentAudioTime);
          }
        } catch (err) {
          console.warn('[BackgroundAudioBridge] Failed to hand back to WebView:', err);
        }
      }
    }
  }

  public destroy() {
    try {
      this.appStateSubscription?.remove?.();
      if (this.focusKeeperPlayer) {
        this.focusKeeperPlayer.pause();
        this.focusKeeperPlayer = null;
      }
      if (this.player) {
        this.player.pause();
        this.player = null;
      }
    } catch {}
  }
}

export const backgroundAudioBridge = new NativeBackgroundAudioBridge();
