import { AppState, AppStateStatus } from 'react-native';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import { extractPlayableStream } from '../api';

interface VideoMeta {
  title?: string;
  author?: string;
  thumbnail?: string;
}

class NativeBackgroundAudioBridge {
  private activeVideoId: string | null = null;
  private lastReportedTime: number = 0;
  private isWebViewPlaying: boolean = false;
  private audioStreamUrl: string | null = null;
  private player: VideoPlayer | null = null;
  private activeMeta: VideoMeta = {};
  private isPrewarming: boolean = false;
  private wasPlayingInBackground: boolean = false;
  private appStateSubscription: any = null;
  private injectResumeCallback: ((timeSec: number) => void) | null = null;

  constructor() {
    this.initAppStateListener();
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

    // Video changed: pre-warm audio stream immediately in background
    if (this.activeVideoId !== videoId) {
      this.activeVideoId = videoId;
      this.audioStreamUrl = null;
      void this.prewarmAudioStream(videoId);
    }
  }

  /**
   * Asynchronously extracts direct audio stream URL for native ExoPlayer
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

  /**
   * Prepares the expo-video native ExoPlayer instance
   */
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
          // Re-create player if replaceAsync is not available
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
        // Keep paused while user is in foreground
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
      // SCREEN TURNED OFF OR PHONE LOCKED
      if (this.isWebViewPlaying && this.audioStreamUrl && this.player) {
        try {
          const seekPos = Math.max(0, this.lastReportedTime);
          this.player.currentTime = seekPos;
          this.player.play();
          this.wasPlayingInBackground = true;
        } catch (err) {
          console.warn('[BackgroundAudioBridge] Failed to start background playback:', err);
        }
      }
    } else if (nextState === 'active') {
      // SCREEN TURNED BACK ON / APP IN FOREGROUND
      if (this.wasPlayingInBackground && this.player) {
        try {
          const currentAudioTime = this.player.currentTime;
          this.player.pause();
          this.wasPlayingInBackground = false;

          // Seamlessly resume WebView video from exact second audio reached
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
      if (this.player) {
        this.player.pause();
        this.player = null;
      }
    } catch {}
  }
}

export const backgroundAudioBridge = new NativeBackgroundAudioBridge();
