import { AppState, AppStateStatus } from 'react-native';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';

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
  private focusKeeperPlayer: VideoPlayer | null = null;
  private silentUri: string | null = null;
  private activeMeta: VideoMeta = {};
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
   * Focus Keeper: Android treats the process as active audio player with AUDIO_ACTIVE.
   * Keeps audio mixing open without attempting restricted foreground notification services.
   */
  private setupFocusKeeper() {
    if (!this.silentUri) return;
    try {
      if (!this.focusKeeperPlayer) {
        this.focusKeeperPlayer = createVideoPlayer({
          uri: this.silentUri,
        });
        this.focusKeeperPlayer.loop = true;
        this.focusKeeperPlayer.staysActiveInBackground = true;
        this.focusKeeperPlayer.showNowPlayingNotification = false;
        this.focusKeeperPlayer.audioMixingMode = 'mixWithOthers';
        this.focusKeeperPlayer.volume = 0.001; // virtually silent
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

    this.activeVideoId = videoId;
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
  }

  /**
   * Handle transitions between Foreground (WebView) and Background (Screen OFF / Locked)
   */
  private onAppStateChange(nextState: AppStateStatus) {
    if (nextState === 'background' || nextState === 'inactive') {
      // Keep focus keeper active while phone is locked or app is in background
      if (this.isWebViewPlaying && this.focusKeeperPlayer) {
        try {
          this.focusKeeperPlayer.play();
        } catch {}
      }
    } else if (nextState === 'active') {
      // Screen Turned Back ON - trigger resume on WebView
      if (this.isWebViewPlaying && this.injectResumeCallback && this.lastReportedTime > 0) {
        this.injectResumeCallback(this.lastReportedTime);
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
    } catch {}
  }
}

export const backgroundAudioBridge = new NativeBackgroundAudioBridge();
