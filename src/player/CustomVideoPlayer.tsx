/* eslint-disable react-hooks/immutability, react-hooks/refs */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Modal,
  Dimensions,
  StatusBar,
  Animated,
  ScrollView,
  Platform,
  PanResponder,
  AppState,
  AppStateStatus,
} from 'react-native';
import {
  useVideoPlayer,
  VideoView,
  VideoContentFit,
  isPictureInPictureSupported,
  VideoSource,
  ContentType,
} from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { NavigationBar } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { fetchSponsorSegments, checkAndGetSkipPosition, SponsorSegment } from '../api/sponsorBlock';
import { saveWatchProgress } from '../database/repositories/historyRepo';
import { configureBackgroundAudio } from './audioMode';
import { StreamFormatOption, AudioTrackOption, CaptionTrackOption, AppVideoItem } from '../api/types';
import { DashFormatInfo, createDashManifestFile } from './dashManifestBuilder';
import { fetchSubtitleCues, getCurrentSubtitleText, SubtitleCue } from './subtitleService';
import { registerActivePlayer, unregisterActivePlayer } from './playerCoordinator';
import { getAutoplaySetting, setAutoplaySetting } from '../utils/autoplayStorage';
import { YouTubeWebEngine, YouTubeWebEngineRef } from './YouTubeWebEngine';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CustomVideoPlayerProps {
  videoId: string;
  streamUrl: string;
  audioStreamUrl?: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  qualityLabel?: string;
  availableQualities?: StreamFormatOption[];
  rawVideoFormats?: DashFormatInfo[];
  rawAudioFormats?: DashFormatInfo[];
  audioTracks?: AudioTrackOption[];
  activeAudioTrackId?: string;
  captionTracks?: CaptionTrackOption[];
  onAudioTrackChange?: (track: AudioTrackOption) => void;
  onQualityChange?: (url: string, label: string) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  onClose?: () => void;
  nextVideo?: AppVideoItem | null;
  onPlayNextVideo?: () => void;
  userAgent?: string;
  durationSeconds?: number;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export const CustomVideoPlayer: React.FC<CustomVideoPlayerProps> = ({
  videoId,
  streamUrl,
  audioStreamUrl,
  title,
  author,
  thumbnailUrl,
  qualityLabel = '720p',
  availableQualities = [],
  rawVideoFormats = [],
  rawAudioFormats = [],
  audioTracks = [],
  activeAudioTrackId,
  captionTracks = [],
  onAudioTrackChange,
  onQualityChange,
  onFullscreenChange,
  onClose,
  nextVideo,
  onPlayNextVideo,
  userAgent,
  durationSeconds,
}) => {
  const insets = useSafeAreaInsets();
  const videoViewRef = useRef<VideoView>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showControls, setShowControls] = useState<boolean>(true);
  const controlsOpacity = useMemo(() => new Animated.Value(1), []);
  const autoHideTimerRef = useRef<any>(null);

  const clearAutoHideTimer = () => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  };

  const showPlayerControls = (duration = 180) => {
    clearAutoHideTimer();
    setShowControls(true);
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    }).start();

    if (isPlaying) {
      autoHideTimerRef.current = setTimeout(() => {
        hidePlayerControls();
      }, 3500);
    }
  };

  const hidePlayerControls = (duration = 240) => {
    clearAutoHideTimer();
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowControls(false);
      }
    });
  };

  const resetAutoHideTimer = () => {
    clearAutoHideTimer();
    if (isPlaying && showControls) {
      autoHideTimerRef.current = setTimeout(() => {
        hidePlayerControls();
      }, 3500);
    }
  };

  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [durationSec, setDurationSec] = useState<number>(durationSeconds || 0);
  const [bufferedSec, setBufferedSec] = useState<number>(0);
  const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
  const sponsorSegmentsRef = useRef<SponsorSegment[]>([]);
  const [sponsorSkippedNotice, setSponsorSkippedNotice] = useState<string | null>(null);

  // Quality, Fullscreen & Theater states
  const [activeQuality, setActiveQuality] = useState<string>(qualityLabel);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);
  const [contentFit, setContentFit] = useState<VideoContentFit>('contain');

  // Player Engine: 'official' (Zero-Ad Official Web Engine, Zero Freeze 1080p/1440p)
  const webEngineRef = useRef<YouTubeWebEngineRef>(null);
  const [playerEngine, setPlayerEngine] = useState<'official' | 'native'>('official');

  // Autoplay Next Video states & Persistent Preference
  const [isAutoplayEnabled, setIsAutoplayEnabled] = useState<boolean>(false);
  const [isEnded, setIsEnded] = useState<boolean>(false);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const isEndedRef = useRef<boolean>(false);

  // Load saved Autoplay preference on mount
  useEffect(() => {
    getAutoplaySetting().then(val => {
      setIsAutoplayEnabled(val);
    });
  }, []);

  // Handle Autoplay Next Video Toggle
  const handleToggleAutoplay = async () => {
    const nextVal = !isAutoplayEnabled;
    setIsAutoplayEnabled(nextVal);
    await setAutoplaySetting(nextVal);
    setNoticeText(nextVal ? 'Autoplay is on' : 'Autoplay is off');
    setTimeout(() => setNoticeText(null), 2000);

    if (nextVal && isEndedRef.current && nextVideo) {
      setCountdownSec(5);
    } else if (!nextVal) {
      setCountdownSec(null);
    }
  };

  // Replay Video from start
  const handleReplay = () => {
    isEndedRef.current = false;
    setIsEnded(false);
    setCountdownSec(null);
    setCurrentTimeSec(0);
    lastKnownPositionRef.current = 0;
    if (playerEngine === 'official') {
      webEngineRef.current?.seekTo(0);
      webEngineRef.current?.play();
      setIsPlaying(true);
    } else if (player) {
      player.currentTime = 0;
      player.play();
    }
  };

  // Up Next Countdown Effect
  useEffect(() => {
    if (countdownSec === null) return;
    const timer = setTimeout(() => {
      if (countdownSec <= 1) {
        setCountdownSec(null);
        setIsEnded(false);
        isEndedRef.current = false;
        onPlayNextVideo?.();
      } else {
        setCountdownSec(countdownSec - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdownSec, onPlayNextVideo]);

  // Double tap seeking indicators
  const [doubleTapSide, setDoubleTapSide] = useState<'left' | 'right' | null>(null);
  const doubleTapAnim = useMemo(() => new Animated.Value(0), []);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // Audio-only mode
  const [isAudioOnlyMode, setIsAudioOnlyMode] = useState<boolean>(false);

  // Two-Finger Pinch-to-Zoom & Pan Gesture States (MX Player / YouTube style)
  const zoomScaleAnim = useMemo(() => new Animated.Value(1), []);
  const zoomPanXAnim = useMemo(() => new Animated.Value(0), []);
  const zoomPanYAnim = useMemo(() => new Animated.Value(0), []);

  const currentScaleRef = useRef<number>(1);
  const currentPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialPinchDistRef = useRef<number>(0);
  const initialScaleOnPinchRef = useRef<number>(1);
  const initialPinchCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialPanOnPinchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPinchingRef = useRef<boolean>(false);
  const zoomNoticeTimerRef = useRef<any>(null);

  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [zoomNoticeText, setZoomNoticeText] = useState<string | null>(null);

  const resetZoom = (animated = true) => {
    currentScaleRef.current = 1;
    currentPanRef.current = { x: 0, y: 0 };
    setIsZoomed(false);
    setZoomNoticeText(null);
    if (animated) {
      Animated.parallel([
        Animated.spring(zoomScaleAnim, {
          toValue: 1,
          friction: 7,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.spring(zoomPanXAnim, {
          toValue: 0,
          friction: 7,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.spring(zoomPanYAnim, {
          toValue: 0,
          friction: 7,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      zoomScaleAnim.setValue(1);
      zoomPanXAnim.setValue(0);
      zoomPanYAnim.setValue(0);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: e => {
          // If 2 touches present, claim immediately for pinch gesture
          return Boolean(e.nativeEvent.touches && e.nativeEvent.touches.length >= 2);
        },
        onMoveShouldSetPanResponder: (e, gestureState) => {
          // If 2 touches present during movement, claim for pinch-to-zoom
          if (e.nativeEvent.touches && e.nativeEvent.touches.length >= 2) {
            return true;
          }
          // If already zoomed in (>1.08) and finger drags > 6px, claim for panning
          if (
            currentScaleRef.current > 1.08 &&
            (Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6)
          ) {
            return true;
          }
          return false;
        },
        onPanResponderGrant: e => {
          const touches = e.nativeEvent.touches;
          if (touches && touches.length >= 2) {
            isPinchingRef.current = true;
            const t0 = touches[0];
            const t1 = touches[1];
            const dist = Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY);
            initialPinchDistRef.current = Math.max(dist, 1);
            initialScaleOnPinchRef.current = currentScaleRef.current;
            initialPinchCenterRef.current = {
              x: (t0.pageX + t1.pageX) / 2,
              y: (t0.pageY + t1.pageY) / 2,
            };
            initialPanOnPinchRef.current = { ...currentPanRef.current };
          } else if (currentScaleRef.current > 1.08) {
            initialPanOnPinchRef.current = { ...currentPanRef.current };
          }
        },
        onPanResponderMove: (e, gestureState) => {
          const touches = e.nativeEvent.touches;
          const windowDim = Dimensions.get('window');
          const containerW = isFullscreen
            ? Math.max(windowDim.width, windowDim.height)
            : windowDim.width;
          const containerH = isFullscreen
            ? Math.min(windowDim.width, windowDim.height)
            : isTheaterMode
            ? 290
            : 230;

          if (touches && touches.length >= 2) {
            const t0 = touches[0];
            const t1 = touches[1];
            const dist = Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY);
            const ratio = dist / Math.max(initialPinchDistRef.current, 1);
            const targetScale = Math.min(3.8, Math.max(0.85, initialScaleOnPinchRef.current * ratio));

            zoomScaleAnim.setValue(targetScale);
            currentScaleRef.current = targetScale;

            const currentCenter = {
              x: (t0.pageX + t1.pageX) / 2,
              y: (t0.pageY + t1.pageY) / 2,
            };
            const deltaX = currentCenter.x - initialPinchCenterRef.current.x;
            const deltaY = currentCenter.y - initialPinchCenterRef.current.y;

            const maxPanX = (containerW * (targetScale - 1)) / 2;
            const maxPanY = (containerH * (targetScale - 1)) / 2;

            const newPanX = Math.max(
              -maxPanX,
              Math.min(maxPanX, initialPanOnPinchRef.current.x + deltaX)
            );
            const newPanY = Math.max(
              -maxPanY,
              Math.min(maxPanY, initialPanOnPinchRef.current.y + deltaY)
            );

            zoomPanXAnim.setValue(newPanX);
            zoomPanYAnim.setValue(newPanY);
            currentPanRef.current = { x: newPanX, y: newPanY };

            if (targetScale > 1.08) {
              setZoomNoticeText(`${Math.round(targetScale * 100)}%`);
              setIsZoomed(true);
            } else {
              setZoomNoticeText(null);
              setIsZoomed(false);
            }
          } else if (currentScaleRef.current > 1.08 && !isPinchingRef.current) {
            const targetScale = currentScaleRef.current;
            const maxPanX = (containerW * (targetScale - 1)) / 2;
            const maxPanY = (containerH * (targetScale - 1)) / 2;

            const newPanX = Math.max(
              -maxPanX,
              Math.min(maxPanX, initialPanOnPinchRef.current.x + gestureState.dx)
            );
            const newPanY = Math.max(
              -maxPanY,
              Math.min(maxPanY, initialPanOnPinchRef.current.y + gestureState.dy)
            );

            zoomPanXAnim.setValue(newPanX);
            zoomPanYAnim.setValue(newPanY);
            currentPanRef.current = { x: newPanX, y: newPanY };
          }
        },
        onPanResponderRelease: () => {
          isPinchingRef.current = false;
          if (currentScaleRef.current <= 1.08) {
            resetZoom(true);
          } else {
            setIsZoomed(true);
            setZoomNoticeText(`${Math.round(currentScaleRef.current * 100)}%`);
            if (zoomNoticeTimerRef.current) clearTimeout(zoomNoticeTimerRef.current);
            zoomNoticeTimerRef.current = setTimeout(() => {
              setZoomNoticeText(null);
            }, 1800);
          }
        },
        onPanResponderTerminate: () => {
          isPinchingRef.current = false;
          if (currentScaleRef.current <= 1.08) {
            resetZoom(true);
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isFullscreen, isTheaterMode, zoomPanXAnim, zoomPanYAnim, zoomScaleAnim]
  );

  // Settings Modals
  const [showSpeedModal, setShowSpeedModal] = useState<boolean>(false);
  const [showQualityModal, setShowQualityModal] = useState<boolean>(false);
  const [showAudioModal, setShowAudioModal] = useState<boolean>(false);
  const [showCaptionModal, setShowCaptionModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(1.0);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const currentAudioTrackId = selectedAudioTrackId ?? activeAudioTrackId ?? '';

  // Subtitles / Closed Captions
  const [selectedCaptionTrackId, setSelectedCaptionTrackId] = useState<string | null>(null);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string | null>(null);
  const subtitleCuesRef = useRef<SubtitleCue[]>([]);

  // Persistent Position Lock & Loaded Source Tracking (Prevents restarting on rotation & quality change)
  const lastKnownPositionRef = useRef<number>(0);
  const loadedSourceUriRef = useRef<string>('');
  const pendingSeekPositionRef = useRef<number>(0);
  const lastSavedSecRef = useRef<number>(0);
  const lastSkippedTargetRef = useRef<number>(0);
  const lastReArmPosRef = useRef<number>(0);
  const hasFallenBackRef = useRef<boolean>(false);
  const durationSecondsRef = useRef<number | undefined>(durationSeconds);
  durationSecondsRef.current = durationSeconds;
  const durationSecRef = useRef<number>(durationSeconds || 0);

  const activeSourceUrl = isAudioOnlyMode && audioStreamUrl ? audioStreamUrl : streamUrl;

  const STREAM_HEADERS = useMemo(
    () => ({
      'User-Agent':
        userAgent ||
        'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.0 Safari/537.36',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
    }),
    [userAgent]
  );

  const buildVideoSource = (url: string | null | undefined): VideoSource => {
    if (!url) return null;
    const isDash = url.endsWith('.mpd');
    return {
      uri: url,
      contentType: isDash ? ('dash' as ContentType) : ('progressive' as ContentType),
      headers: STREAM_HEADERS,
    };
  };

  // Stable initial source with official YouTube Android headers to prevent 1-minute stream dropouts
  const initialSource: VideoSource = useMemo(() => {
    return buildVideoSource(activeSourceUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize Modern Expo Video Player
  const player = useVideoPlayer(initialSource, p => {
    p.loop = false;
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
    p.timeUpdateEventInterval = 0.5;
    p.playbackRate = currentSpeed;
    p.bufferOptions = {
      preferredForwardBufferDuration: 45,
      waitsToMinimizeStalling: true,
      minBufferForPlayback: 2.5,
      prioritizeTimeOverSizeThreshold: true,
      maxBufferBytes: 250 * 1024 * 1024, // 250 MB high-resolution buffer prevents throttling & mid-stream stall
    };
    p.pause();
  });

  // Track the initial source URI in ref
  useEffect(() => {
    if (activeSourceUrl) {
      loadedSourceUriRef.current = activeSourceUrl;
    }
  }, [activeSourceUrl]);

  // Background Audio & SponsorBlock setup
  useEffect(() => {
    configureBackgroundAudio();
    fetchSponsorSegments(videoId).then(segments => {
      sponsorSegmentsRef.current = segments;
      setSponsorSegments(segments);
    });
  }, [videoId]);

  // Sync external streamUrl changes with ZERO loss of current playback position
  useEffect(() => {
    if (!player) return;
    const targetUri = isAudioOnlyMode && audioStreamUrl ? audioStreamUrl : streamUrl;
    if (!targetUri || targetUri === loadedSourceUriRef.current) {
      // Stream is already playing or identical; skip redundant replace to prevent restarting
      return;
    }

    loadedSourceUriRef.current = targetUri;
    isEndedRef.current = false;
    setIsEnded(false);
    setCountdownSec(null);
    const resumePos = player.currentTime || lastKnownPositionRef.current || 0;
    const newSource = buildVideoSource(targetUri);

    player.replaceAsync(newSource).then(() => {
      player.staysActiveInBackground = true;
      player.showNowPlayingNotification = true;
      player.bufferOptions = {
        preferredForwardBufferDuration: 45,
        waitsToMinimizeStalling: true,
        minBufferForPlayback: 2.5,
        prioritizeTimeOverSizeThreshold: true,
        maxBufferBytes: 250 * 1024 * 1024,
      };
      if (resumePos > 0) {
        player.currentTime = resumePos;
      }
      if (playerEngine === 'official') {
        try {
          player.pause();
        } catch {}
      } else {
        player.play();
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, isAudioOnlyMode]);

  // Screen Orientation & Fullscreen Sync (Landscape Lock with JS overlay intact)
  useEffect(() => {
    const sub = ScreenOrientation.addOrientationChangeListener(event => {
      const o = event.orientationInfo.orientation;
      const isLandscape =
        o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      setIsFullscreen(isLandscape);
      onFullscreenChange?.(isLandscape);
      if (Platform.OS === 'android') {
        try {
          NavigationBar.setHidden(isLandscape);
        } catch {}
      }
    });

    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      if (Platform.OS === 'android') {
        try {
          NavigationBar.setHidden(false);
        } catch {}
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android Immersive Sticky Fullscreen: Completely hide bottom navigation bar / swipe pill
  useEffect(() => {
    if (Platform.OS === 'android') {
      try {
        NavigationBar.setHidden(isFullscreen);
      } catch (err) {
        console.warn('[NavigationBar] error:', err);
      }
    }
  }, [isFullscreen]);

  // Mobile Screen Off & Background Audio Bridge (Zero-Interruption Background Playback)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // Mobile screen turned off OR app minimized: seamlessly engage native ExoPlayer background audio
        if (isPlaying) {
          const currentPos = currentTimeSec || lastKnownPositionRef.current || 0;
          if (playerEngine === 'official') {
            try {
              webEngineRef.current?.pause();
            } catch {}
            if (player) {
              try {
                player.staysActiveInBackground = true;
                player.showNowPlayingNotification = true;
                player.currentTime = currentPos;
                player.play();
              } catch {}
            }
          }
        }
      } else if (nextAppState === 'active') {
        // Mobile screen turned ON / app returned to foreground: resume high-definition visual playback
        if (playerEngine === 'official') {
          const resumePos = (player && player.currentTime > 0) ? player.currentTime : (currentTimeSec || 0);
          try {
            player?.pause();
          } catch {}
          if (isPlaying) {
            webEngineRef.current?.seekTo(resumePos);
            webEngineRef.current?.play();
            setCurrentTimeSec(resumePos);
          }
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [isPlaying, playerEngine, player, currentTimeSec]);

  // YouTube Official Web Engine event bridges (Zero-Freeze 1080p Engine)
  const handleWebReady = (dur: number) => {
    setIsLoading(false);
    if (dur > 0) {
      setDurationSec(dur);
      durationSecRef.current = dur;
    }
    if (pendingSeekPositionRef.current > 0) {
      const pos = pendingSeekPositionRef.current;
      pendingSeekPositionRef.current = 0;
      webEngineRef.current?.seekTo(pos);
    }
    setIsPlaying(true);
    webEngineRef.current?.play();
  };

  const handleWebTimeUpdate = (cur: number, dur: number, bufSec: number) => {
    setCurrentTimeSec(cur);
    lastKnownPositionRef.current = cur;
    if (dur > 0) {
      setDurationSec(dur);
      durationSecRef.current = dur;
    }
    if (bufSec >= 0) {
      setBufferedSec(bufSec);
    }

    // Live Subtitle Synchronization
    if (selectedCaptionTrackId && subtitleCuesRef.current.length > 0) {
      const activeSub = getCurrentSubtitleText(subtitleCuesRef.current, cur * 1000);
      setCurrentSubtitleText(activeSub);
    } else if (currentSubtitleText !== null) {
      setCurrentSubtitleText(null);
    }

    // SponsorBlock Auto-Skip check (Instant Real-time)
    const activeSegments = sponsorSegmentsRef.current.length > 0 ? sponsorSegmentsRef.current : sponsorSegments;
    const targetSkipSeconds = checkAndGetSkipPosition(cur, activeSegments);
    if (
      targetSkipSeconds !== null &&
      Math.abs(lastSkippedTargetRef.current - targetSkipSeconds) > 1.5 &&
      Math.abs(cur - targetSkipSeconds) > 0.8
    ) {
      lastSkippedTargetRef.current = targetSkipSeconds;
      webEngineRef.current?.seekTo(targetSkipSeconds);
      lastKnownPositionRef.current = targetSkipSeconds;
      setSponsorSkippedNotice('Skipped Sponsor Segment');
      setTimeout(() => setSponsorSkippedNotice(null), 2500);
    } else if (lastSkippedTargetRef.current > 0 && cur > lastSkippedTargetRef.current + 2) {
      lastSkippedTargetRef.current = 0;
    }

    // Save watch history periodically
    const curSec = Math.floor(cur);
    if (curSec > 3 && dur > 0 && curSec % 5 === 0 && curSec !== lastSavedSecRef.current) {
      lastSavedSecRef.current = curSec;
      saveWatchProgress(
        videoId,
        title,
        author,
        thumbnailUrl,
        curSec * 1000,
        Math.floor(dur * 1000)
      ).catch(() => {});
    }
  };

  const handleWebStateChange = (playing: boolean, buffering: boolean, ended: boolean) => {
    setIsPlaying(playing);
    setIsLoading(buffering);
    if (ended && !isEndedRef.current) {
      isEndedRef.current = true;
      setIsEnded(true);
      if (isAutoplayEnabled && nextVideo) {
        setCountdownSec(5);
      }
    }
  };

  const handleWebQualityChange = (q: string) => {
    console.log('[YouTubeWebEngine] Active quality changed to:', q);
  };

  const handleWebError = (err: any) => {
    console.warn('[YouTubeWebEngine] Non-fatal WebEngine event:', err);
    // Only fall back to native if the error is a critical fatal code (100 = video deleted, 101/150 = embedding blocked)
    if (err?.code === 101 || err?.code === 150 || err?.code === 100) {
      console.warn('[YouTubeWebEngine] Fatal embed error, switching to native fallback:', err);
      setPlayerEngine('native');
      if (player) {
        try {
          const resume = lastKnownPositionRef.current || currentTimeSec || 0;
          player.currentTime = resume;
          player.play();
          setIsPlaying(true);
        } catch {}
      }
    }
  };

  // Player Events (Playing status, Time update, Subtitle sync, Buffer & History)
  useEffect(() => {
    if (!player) return;

    if (playerEngine === 'official') {
      try {
        player.pause();
      } catch {}
      return;
    }

    registerActivePlayer(player);
    try {
      player.play();
    } catch {}

    const autoPlayTimer = setTimeout(() => {
      if (player && !player.playing) {
        try {
          player.play();
        } catch {}
      }
    }, 300);

    const playingSub = player.addListener('playingChange', event => {
      setIsPlaying(event.isPlaying);
      if (event.isPlaying) {
        registerActivePlayer(player);
      }
    });

    const statusSub = player.addListener('statusChange', event => {
      setIsLoading(event.status === 'loading');
      if (event.status === 'readyToPlay') {
        try {
          player.play();
        } catch {}
        if (pendingSeekPositionRef.current > 0) {
          const target = pendingSeekPositionRef.current;
          pendingSeekPositionRef.current = 0;
          player.currentTime = target;
          lastKnownPositionRef.current = target;
          player.play();
        }
      }
    });

    const sourceLoadSub = player.addListener('sourceLoad', () => {
      try {
        player.play();
      } catch {}
      if (pendingSeekPositionRef.current > 0) {
        const target = pendingSeekPositionRef.current;
        pendingSeekPositionRef.current = 0;
        player.currentTime = target;
        lastKnownPositionRef.current = target;
        player.play();
      }
    });

    const playToEndSub = player.addListener('playToEnd', () => {
      if (!isEndedRef.current) {
        isEndedRef.current = true;
        setIsEnded(true);
        if (isAutoplayEnabled && nextVideo) {
          setCountdownSec(5);
        }
      }
    });

    const timeSub = player.addListener('timeUpdate', event => {
      const cur = event.currentTime;
      const rawDur = player.duration || 0;
      const refDur = durationSecondsRef.current || durationSecRef.current || 0;
      const realDur =
        refDur > 0
          ? (rawDur > 0 && rawDur >= refDur ? rawDur : refDur)
          : rawDur;

      setCurrentTimeSec(cur);
      if (realDur > 0) {
        durationSecRef.current = realDur;
        setDurationSec(realDur);
      }
      lastKnownPositionRef.current = cur;

      // Detect end of video: ONLY when within 0.8s of the full video duration
      if (realDur > 3 && cur >= realDur - 0.8 && !isEndedRef.current) {
        isEndedRef.current = true;
        setIsEnded(true);
        if (isAutoplayEnabled && nextVideo) {
          setCountdownSec(5);
        }
      }

      // Update buffer position for dual-layer progress bar
      if (typeof player.bufferedPosition === 'number' && player.bufferedPosition >= 0) {
        setBufferedSec(player.bufferedPosition);
      } else {
        setBufferedSec(cur);
      }

      // Live Subtitle Synchronization
      if (selectedCaptionTrackId && subtitleCuesRef.current.length > 0) {
        const activeSub = getCurrentSubtitleText(subtitleCuesRef.current, cur * 1000);
        setCurrentSubtitleText(activeSub);
      } else if (currentSubtitleText !== null) {
        setCurrentSubtitleText(null);
      }

      // Save watch history periodically (throttled to every 5s to avoid thread congestion)
      const curSec = Math.floor(cur);
      if (curSec > 3 && realDur > 0 && curSec % 5 === 0 && curSec !== lastSavedSecRef.current) {
        lastSavedSecRef.current = curSec;
        saveWatchProgress(
          videoId,
          title,
          author,
          thumbnailUrl,
          curSec * 1000,
          Math.floor(realDur * 1000)
        ).catch(() => {});
      }

      // Pre-emptive Connection Re-Arming for DASH (prevents 54s & 1m 59s SABR throttle cliffs)
      if (
        loadedSourceUriRef.current.endsWith('.mpd') &&
        cur > 5 &&
        cur - lastReArmPosRef.current >= 38
      ) {
        lastReArmPosRef.current = cur;
        try {
          // 1ms micro-seek is imperceptible to audio/video but signals ExoPlayer to re-arm HTTP range pipeline
          player.seekBy(0.001);
        } catch {}
      }

      // Hybrid Smart HD: If playing DASH on a SABR-constrained video approaching the 46s-55s cutoff,
      // seamlessly bridge to progressive stream before the 403 cliff hits, so user NEVER experiences a freeze!
      if (
        loadedSourceUriRef.current.endsWith('.mpd') &&
        cur >= 44 &&
        !hasFallenBackRef.current &&
        streamUrl
      ) {
        const buf = player.bufferedPosition || 0;
        if (buf < cur + 5.0) {
          hasFallenBackRef.current = true;
          console.log('[HybridSmartHD] SABR cutoff zone reached at', cur, 's. Bridging seamlessly to progressive stream.');
          const fallbackSource = buildVideoSource(streamUrl);
          loadedSourceUriRef.current = streamUrl;
          player.replaceAsync(fallbackSource).then(() => {
            player.currentTime = cur;
            player.play();
          }).catch(() => {});
        }
      }

      // SponsorBlock Auto-Skip check (Debounced to prevent infinite seek re-trigger loop)
      const activeSegments = sponsorSegmentsRef.current.length > 0 ? sponsorSegmentsRef.current : sponsorSegments;
      const targetSkipSeconds = checkAndGetSkipPosition(cur, activeSegments);
      if (
        targetSkipSeconds !== null &&
        Math.abs(lastSkippedTargetRef.current - targetSkipSeconds) > 1.5 &&
        Math.abs(cur - targetSkipSeconds) > 0.8
      ) {
        lastSkippedTargetRef.current = targetSkipSeconds;
        player.currentTime = targetSkipSeconds;
        lastKnownPositionRef.current = targetSkipSeconds;
        setSponsorSkippedNotice('Skipped Sponsor Segment');
        setTimeout(() => setSponsorSkippedNotice(null), 2500);
      } else if (lastSkippedTargetRef.current > 0 && cur > lastSkippedTargetRef.current + 2) {
        lastSkippedTargetRef.current = 0;
      }
    });

    return () => {
      clearTimeout(autoPlayTimer);
      playingSub.remove();
      statusSub.remove();
      sourceLoadSub.remove();
      playToEndSub.remove();
      timeSub.remove();
      unregisterActivePlayer(player);
      try {
        player.pause();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, videoId, title, author, thumbnailUrl, sponsorSegments, selectedCaptionTrackId, currentSubtitleText, isAutoplayEnabled, nextVideo]);

  // Controls Visibility & Auto-Hide Watcher
  useEffect(() => {
    let timer: any;
    if (isPlaying && showControls) {
      timer = setTimeout(() => {
        hidePlayerControls();
      }, 3500);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, showControls]);

  // Buffer Stall Auto-Recovery Watchdog (Fast 1.5s detection with progressive fallback safety net)
  useEffect(() => {
    if (!player || !isPlaying) return;

    let prevPos = player.currentTime || 0;
    let consecutiveStalls = 0;

    const interval = setInterval(() => {
      if (!player) return;
      const cur = player.currentTime || 0;
      const buf = player.bufferedPosition || 0;

      // Do not count stalls while player is actively loading initial media
      if (player.status === 'loading') {
        consecutiveStalls = 0;
        prevPos = cur;
        return;
      }

      // If position has not advanced while player is supposedly playing
      if (cur > 0 && Math.abs(cur - prevPos) < 0.1 && player.playing) {
        // If buffer is already >2.0s ahead, player is rendering frames, do not interrupt
        if (buf > cur + 2.0) {
          consecutiveStalls = 0;
        } else {
          consecutiveStalls++;
          // First attempt at 1.5s: gently poke play() to re-awaken pipeline
          if (consecutiveStalls === 1) {
            try {
              player.play();
            } catch {}
          }
          // Instant stall recovery: If playing DASH and stalled for >= 1 check (~1.2s):
          if (consecutiveStalls >= 1 && loadedSourceUriRef.current.endsWith('.mpd') && streamUrl) {
            console.log('[BufferWatchdog] DASH stall detected at', cur, 's. Instant bridge to progressive stream.');
            hasFallenBackRef.current = true;
            const fallbackSource = buildVideoSource(streamUrl);
            loadedSourceUriRef.current = streamUrl;
            player.replaceAsync(fallbackSource).then(() => {
              player.currentTime = cur;
              player.play();
            }).catch(() => {});
            consecutiveStalls = 0;
          } else if (consecutiveStalls >= 4) {
            const resumePos = Math.max(0, cur + 0.2);
            player.currentTime = resumePos;
            lastKnownPositionRef.current = resumePos;
            player.play();
            consecutiveStalls = 0;
          }
        }
      } else {
        consecutiveStalls = 0;
      }
      prevPos = cur;
    }, 1500);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, isPlaying, streamUrl]);

  const togglePlayPause = () => {
    if (playerEngine === 'official') {
      const nextPlaying = !isPlaying;
      if (nextPlaying) {
        webEngineRef.current?.play();
        setIsPlaying(true);
        resetAutoHideTimer();
      } else {
        webEngineRef.current?.pause();
        setIsPlaying(false);
        showPlayerControls();
      }
      return;
    }

    if (!player) return;

    const shouldPlay = !player.playing;
    if (shouldPlay) {
      player.play();
      setIsPlaying(true);
      resetAutoHideTimer();
    } else {
      player.pause();
      setIsPlaying(false);
      showPlayerControls();
    }
  };

  const seekRelative = (offsetSec: number) => {
    resetAutoHideTimer();
    isEndedRef.current = false;
    setIsEnded(false);
    setCountdownSec(null);
    lastSkippedTargetRef.current = 0;
    const curPos = currentTimeSec || player?.currentTime || 0;
    const target = Math.max(0, Math.min(curPos + offsetSec, durationSec || 9999));
    setCurrentTimeSec(target);
    lastKnownPositionRef.current = target;
    if (playerEngine === 'official') {
      webEngineRef.current?.seekTo(target);
    } else if (player) {
      player.seekBy(offsetSec);
    }
  };

  // YouTube-style Fullscreen Toggle
  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        if (Platform.OS === 'android') {
          try {
            NavigationBar.setHidden(true);
          } catch {}
        }
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setIsFullscreen(true);
        onFullscreenChange?.(true);
      } else {
        if (Platform.OS === 'android') {
          try {
            NavigationBar.setHidden(false);
          } catch {}
        }
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setIsFullscreen(false);
        onFullscreenChange?.(false);
      }
    } catch (e) {
      console.warn('Orientation toggle error:', e);
    }
  };

  // Picture-in-Picture Trigger
  const handlePictureInPicture = async () => {
    try {
      if (isPictureInPictureSupported()) {
        await videoViewRef.current?.startPictureInPicture();
      }
    } catch (e) {
      console.warn('Picture-in-Picture error:', e);
    }
  };

  // YouTube-style Quality Selector with Exact Timestamp Resume (No Restarting, No Black Screen, Zero Stalls)
  // YouTube-style Quality Selector with True 1080p/720p/480p DASH Muxing & Exact Timestamp Resume
  const handleQualitySelect = async (item: StreamFormatOption) => {
    setShowQualityModal(false);
    setActiveQuality(item.qualityLabel);

    if (playerEngine === 'official') {
      webEngineRef.current?.setQuality(item.qualityLabel);
      onQualityChange?.('', item.qualityLabel);
      return;
    }

    setIsLoading(true);
    try {
      const resumePos = player?.currentTime || lastKnownPositionRef.current || 0;
      let newSourceUri = '';

      // 1. If an alternate progressive format with video+audio exists, switch directly
      if (item.hasAudio && item.url) {
        newSourceUri = item.url;
      } else if (rawVideoFormats.length > 0 && rawAudioFormats.length > 0) {
        // 2. High-definition adaptive video (1080p, 1440p, 480p): Generate synchronized DASH manifest
        const mpdUri = await createDashManifestFile(
          videoId,
          durationSecondsRef.current || durationSecRef.current || 600,
          rawVideoFormats,
          rawAudioFormats,
          item.qualityLabel,
          currentAudioTrackId
        );
        if (mpdUri) {
          newSourceUri = mpdUri;
        }
      }

      if (newSourceUri && newSourceUri !== loadedSourceUriRef.current) {
        loadedSourceUriRef.current = newSourceUri;
        const newSource = buildVideoSource(newSourceUri);
        if (player) {
          isEndedRef.current = false;
          setIsEnded(false);
          await player.replaceAsync(newSource);
          player.bufferOptions = {
            preferredForwardBufferDuration: 60,
            waitsToMinimizeStalling: true,
            minBufferForPlayback: 2.0,
            prioritizeTimeOverSizeThreshold: true,
            maxBufferBytes: 250 * 1024 * 1024,
          };
          if (resumePos > 0) {
            player.currentTime = resumePos;
            lastKnownPositionRef.current = resumePos;
          }
          player.play();
        }
      } else {
        // Locked to current high-bandwidth pipeline
        if (player) {
          player.bufferOptions = {
            preferredForwardBufferDuration: 60,
            waitsToMinimizeStalling: true,
            minBufferForPlayback: 2.0,
            prioritizeTimeOverSizeThreshold: true,
            maxBufferBytes: 250 * 1024 * 1024,
          };
        }
      }
    } catch (err) {
      console.warn('Quality change error:', err);
    } finally {
      setIsLoading(false);
    }

    setActiveQuality(item.qualityLabel);
    onQualityChange?.(loadedSourceUriRef.current, item.qualityLabel);
  };

  // YouTube Multi-Language Audio Track Selector
  const handleAudioTrackSelect = async (track: AudioTrackOption) => {
    setShowAudioModal(false);
    setIsLoading(true);
    try {
      const resumePos = player?.currentTime || lastKnownPositionRef.current || 0;
      pendingSeekPositionRef.current = resumePos;

      const newSourceUri = track.url || streamUrl;

      const newSource = buildVideoSource(newSourceUri);
      loadedSourceUriRef.current = newSourceUri;

      if (player) {
        isEndedRef.current = false;
        setIsEnded(false);
        const currentUri = (player as any).currentSource?.uri;
        if (newSourceUri && newSourceUri !== currentUri) {
          await player.replaceAsync(newSource);
          player.bufferOptions = {
            preferredForwardBufferDuration: 45,
            waitsToMinimizeStalling: true,
            minBufferForPlayback: 2.5,
            prioritizeTimeOverSizeThreshold: true,
            maxBufferBytes: 250 * 1024 * 1024,
          };
          if (resumePos > 0) {
            player.currentTime = resumePos;
            lastKnownPositionRef.current = resumePos;
          }
          player.play();
        }
      }

      setSelectedAudioTrackId(track.id);
      onAudioTrackChange?.(track);
    } catch (err) {
      console.warn('Audio track switch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // YouTube Subtitle / Closed Caption Selector
  const handleCaptionTrackSelect = async (track: CaptionTrackOption | null) => {
    setShowCaptionModal(false);
    if (!track) {
      // Captions turned off
      setSelectedCaptionTrackId(null);
      subtitleCuesRef.current = [];
      setCurrentSubtitleText(null);
      return;
    }

    try {
      setIsLoading(true);
      const cues = await fetchSubtitleCues(track.baseUrl);
      subtitleCuesRef.current = cues;
      setSelectedCaptionTrackId(track.id);
      // Immediately test current timestamp
      const immediateSub = getCurrentSubtitleText(cues, (player?.currentTime || 0) * 1000);
      setCurrentSubtitleText(immediateSub);
    } catch (err) {
      console.warn('Caption load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // YouTube Double-Tap to Seek & Single-Tap Handler
  const handlePlayerTap = (e: any) => {
    // eslint-disable-next-line react-hooks/purity -- event handlers are intentionally impure
    const now = Date.now();
    const { locationX } = e.nativeEvent;
    const windowWidth = Dimensions.get('window').width;
    const timeDelta = now - lastTapRef.current.time;

    // Double tap within 320ms: seek ±10s with visual ripple, or reset zoom if zoomed in
    if (timeDelta < 320) {
      if (isZoomed && locationX >= windowWidth * 0.35 && locationX <= windowWidth * 0.65) {
        resetZoom(true);
        lastTapRef.current = { time: 0, x: 0 };
        return;
      }
      if (locationX < windowWidth * 0.35) {
        seekRelative(-10);
        triggerDoubleTapAnimation('left');
        showPlayerControls();
        lastTapRef.current = { time: 0, x: 0 };
        return;
      }
      if (locationX > windowWidth * 0.65) {
        seekRelative(10);
        triggerDoubleTapAnimation('right');
        showPlayerControls();
        lastTapRef.current = { time: 0, x: 0 };
        return;
      }
    }

    lastTapRef.current = { time: now, x: locationX };

    // Single Tap: instantly toggle controls with smooth animation
    if (!showControls) {
      showPlayerControls();
    } else {
      hidePlayerControls();
    }
  };

  const triggerDoubleTapAnimation = (side: 'left' | 'right') => {
    setDoubleTapSide(side);
    doubleTapAnim.setValue(0);
    Animated.sequence([
      Animated.timing(doubleTapAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(doubleTapAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => setDoubleTapSide(null));
  };

  // Smooth Seekbar / Progress Bar Scrubber
  const handleProgressBarPress = (e: any) => {
    if (durationSec <= 0) return;
    resetAutoHideTimer();
    isEndedRef.current = false;
    setIsEnded(false);
    setCountdownSec(null);
    lastSkippedTargetRef.current = 0;
    const { locationX } = e.nativeEvent;
    const barWidth = Dimensions.get('window').width - 32;
    const ratio = Math.max(0, Math.min(1, locationX / barWidth));
    const targetSec = ratio * durationSec;
    if (playerEngine === 'official') {
      webEngineRef.current?.seekTo(targetSec);
    } else if (player) {
      const curPos = player.currentTime || 0;
      player.seekBy(targetSec - curPos);
    }
    lastKnownPositionRef.current = targetSec;
    setCurrentTimeSec(targetSec);
  };

  const handleSpeedChange = (speed: number) => {
    setCurrentSpeed(speed);
    setShowSpeedModal(false);
    if (playerEngine === 'official') {
      webEngineRef.current?.setPlaybackRate(speed);
    } else if (player) {
      player.playbackRate = speed;
    }
  };

  const formatTime = (seconds: number) => {
    const totalSecs = Math.floor(seconds || 0);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const containerHeight = isFullscreen
    ? undefined
    : isTheaterMode
    ? 290
    : 230;

  return (
    <View
      style={[
        styles.container,
        { height: containerHeight },
        isFullscreen && styles.fullscreenContainer,
      ]}
    >
      <StatusBar hidden={isFullscreen} translucent backgroundColor="transparent" />
      {Platform.OS === 'android' && <NavigationBar hidden={isFullscreen} />}

      {/* Video or Audio-Mode View (supports smooth pinch-to-zoom & panning) */}
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                { translateX: zoomPanXAnim },
                { translateY: zoomPanYAnim },
                { scale: zoomScaleAnim },
              ],
            },
          ]}
        >
          {isAudioOnlyMode ? (
            <View style={styles.audioModeContainer}>
              <Ionicons name="musical-notes" size={48} color="#FF0000" />
              <Text style={styles.audioModeText}>Background Audio Mode Active</Text>
              <Text style={styles.audioModeSub}>Display off for maximum battery saving</Text>
            </View>
          ) : playerEngine === 'official' ? (
            <YouTubeWebEngine
              ref={webEngineRef}
              videoId={videoId}
              initialQuality={activeQuality}
              isAudioOnly={isAudioOnlyMode}
              onReady={handleWebReady}
              onTimeUpdate={handleWebTimeUpdate}
              onStateChange={handleWebStateChange}
              onQualityChange={handleWebQualityChange}
              onError={handleWebError}
            />
          ) : (
            <VideoView
              ref={videoViewRef}
              player={player}
              style={styles.videoPlayer}
              surfaceType="surfaceView"
              contentFit={contentFit}
              nativeControls={false}
              allowsPictureInPicture={true}
              startsPictureInPictureAutomatically={true}
            />
          )}
        </Animated.View>
      </View>

      {/* Full-Surface Gesture Surface: Two-finger pinch-to-zoom, pan & tap backdrop */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        <TouchableWithoutFeedback onPress={handlePlayerTap}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </View>

        {/* Live Subtitle / Closed Caption Overlay */}
        {currentSubtitleText && !isAudioOnlyMode && (
          <View
            style={[
              styles.subtitleContainer,
              isFullscreen && styles.subtitleContainerFullscreen,
              showControls && styles.subtitleContainerShifted,
            ]}
            pointerEvents="none"
          >
            <Text style={styles.subtitleText}>{currentSubtitleText}</Text>
          </View>
        )}

        {/* Double-Tap Seeking Ripples */}
        {doubleTapSide && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.doubleTapOverlay,
              doubleTapSide === 'left' ? styles.doubleTapLeft : styles.doubleTapRight,
              { opacity: doubleTapAnim },
            ]}
          >
            <Ionicons
              name={doubleTapSide === 'left' ? 'play-back' : 'play-forward'}
              size={36}
              color="#FFFFFF"
            />
            <Text style={styles.doubleTapText}>
              {doubleTapSide === 'left' ? '-10s' : '+10s'}
            </Text>
          </Animated.View>
        )}

        {isLoading && (
          <View style={styles.loaderContainer} pointerEvents="none">
            <ActivityIndicator size="large" color="#FF0000" />
          </View>
        )}

        {/* Sponsor Skip Alert */}
        {sponsorSkippedNotice && (
          <View style={styles.sponsorNotice} pointerEvents="none">
            <Ionicons name="shield-checkmark" size={16} color="#00E676" />
            <Text style={styles.sponsorNoticeText}>{sponsorSkippedNotice}</Text>
          </View>
        )}

        {/* Autoplay Status Toast Notice */}
        {noticeText && (
          <View style={styles.toastNotice} pointerEvents="none">
            <Ionicons
              name={isAutoplayEnabled ? 'play-circle' : 'pause-circle'}
              size={16}
              color={isAutoplayEnabled ? '#00E676' : '#FF5252'}
            />
            <Text style={styles.toastNoticeText}>{noticeText}</Text>
          </View>
        )}

        {/* Pinch-to-Zoom Level Toast Notice */}
        {zoomNoticeText && (
          <View style={styles.zoomToast} pointerEvents="none">
            <Ionicons name="scan-outline" size={16} color="#FFFFFF" />
            <Text style={styles.zoomToastText}>Zoom: {zoomNoticeText}</Text>
          </View>
        )}

        {/* End of Video: Up Next Autoplay Overlay OR Replay Overlay */}
        {isEnded && (
          <View style={styles.endedOverlay}>
            {countdownSec !== null && nextVideo ? (
              <View style={styles.upNextCard}>
                <Text style={styles.upNextHeader}>
                  Up next in {countdownSec}s
                </Text>
                <View style={styles.upNextDetailsRow}>
                  {nextVideo.thumbnail ? (
                    <Image
                      source={{ uri: nextVideo.thumbnail }}
                      style={styles.upNextThumb}
                      contentFit="cover"
                    />
                  ) : null}
                  <View style={styles.upNextMeta}>
                    <Text style={styles.upNextTitle} numberOfLines={2}>
                      {nextVideo.title}
                    </Text>
                    <Text style={styles.upNextAuthor} numberOfLines={1}>
                      {nextVideo.author}
                    </Text>
                  </View>
                </View>
                <View style={styles.upNextActions}>
                  <TouchableOpacity
                    style={styles.cancelAutoplayBtn}
                    onPress={() => setCountdownSec(null)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelAutoplayText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.playNowBtn}
                    onPress={() => {
                      setCountdownSec(null);
                      setIsEnded(false);
                      isEndedRef.current = false;
                      onPlayNextVideo?.();
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="play" size={16} color="#FFFFFF" />
                    <Text style={styles.playNowText}>PLAY NOW</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.replayContainer}>
                <TouchableOpacity
                  style={styles.replayButton}
                  onPress={handleReplay}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={32} color="#FFFFFF" />
                  <Text style={styles.replayText}>Replay</Text>
                </TouchableOpacity>
                {nextVideo && (
                  <TouchableOpacity
                    style={styles.manualNextBtn}
                    onPress={() => {
                      setIsEnded(false);
                      isEndedRef.current = false;
                      onPlayNextVideo?.();
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.manualNextText} numberOfLines={1}>
                      Next: {nextVideo.title}
                    </Text>
                    <Ionicons name="play-forward" size={16} color="#FF0000" />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* Smooth Animated Custom Controls Overlay */}
        <Animated.View
          style={[
            styles.overlay,
            {
              opacity: controlsOpacity,
              paddingTop: Math.max(insets.top, 8),
              paddingBottom: Math.max(insets.bottom, 8),
              paddingLeft: Math.max(insets.left, 10),
              paddingRight: Math.max(insets.right, 10),
            },
          ]}
          pointerEvents={showControls ? 'box-none' : 'none'}
        >
            {/* Top Bar with Clean YouTube Mobile Controls */}
            <View style={styles.topBar}>
              <TouchableOpacity
                onPress={isFullscreen ? toggleFullscreen : onClose}
                style={styles.iconButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={isFullscreen ? 'arrow-back' : 'chevron-down'}
                  size={24}
                  color="#FFFFFF"
                />
              </TouchableOpacity>
              <Text style={styles.videoTitle} numberOfLines={1} ellipsizeMode="tail">
                {title}
              </Text>

              {/* Right Action Controls */}
              <View style={styles.topBarRight}>
                {/* Reset Zoom Pill Badge (visible when video is zoomed in) */}
                {isZoomed && (
                  <TouchableOpacity
                    onPress={() => resetZoom(true)}
                    style={styles.resetZoomPill}
                    activeOpacity={0.8}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Ionicons name="scan-outline" size={13} color="#FFFFFF" />
                    <Text style={styles.resetZoomText}>Reset</Text>
                  </TouchableOpacity>
                )}

                {/* Subtitles (CC) Button (if captions exist) */}
                {captionTracks && captionTracks.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setShowCaptionModal(true)}
                    style={[
                      styles.topActionBtn,
                      selectedCaptionTrackId ? styles.topActionBtnActive : null,
                    ]}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text
                      style={[
                        styles.topActionBtnText,
                        selectedCaptionTrackId ? { color: '#FFFFFF' } : null,
                      ]}
                    >
                      CC
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Aspect Ratio Fit (Contain / Cover) */}
                <TouchableOpacity
                  onPress={() => {
                    const nextFit = contentFit === 'contain' ? 'cover' : 'contain';
                    setContentFit(nextFit);
                    setNoticeText(nextFit === 'cover' ? 'Zoom to fill' : 'Original fit');
                    setTimeout(() => setNoticeText(null), 1800);
                  }}
                  style={styles.topActionBtn}
                  activeOpacity={0.8}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Ionicons
                    name={contentFit === 'cover' ? 'contract-outline' : 'expand-outline'}
                    size={16}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>

                {/* YouTube Autoplay Toggle Switch */}
                <TouchableOpacity
                  onPress={handleToggleAutoplay}
                  style={styles.autoplaySwitchBtn}
                  activeOpacity={0.8}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <View
                    style={[
                      styles.autoplayTrack,
                      isAutoplayEnabled && styles.autoplayTrackActive,
                    ]}
                  >
                    <Ionicons
                      name={isAutoplayEnabled ? 'play' : 'pause'}
                      size={8}
                      color={isAutoplayEnabled ? '#FFFFFF' : '#888888'}
                    />
                    <View
                      style={[
                        styles.autoplayThumb,
                        isAutoplayEnabled
                          ? styles.autoplayThumbActive
                          : styles.autoplayThumbInactive,
                      ]}
                    />
                  </View>
                </TouchableOpacity>

                {/* Quality Button */}
                <TouchableOpacity
                  onPress={() => setShowQualityModal(true)}
                  style={styles.qualityBadge}
                  activeOpacity={0.8}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={styles.qualityText}>{activeQuality}</Text>
                </TouchableOpacity>

                {/* Settings (⚙️) Button */}
                <TouchableOpacity
                  onPress={() => setShowSettingsModal(true)}
                  style={styles.settingsTopBtn}
                  activeOpacity={0.8}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Ionicons name="settings-sharp" size={17} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Center Playback Controls */}
            <View style={styles.centerControls} pointerEvents="box-none">
              <TouchableOpacity
                onPress={() => seekRelative(-10)}
                style={styles.iconButton}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="play-back" size={32} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={togglePlayPause}
                style={styles.playPauseBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={36}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => seekRelative(10)}
                style={styles.iconButton}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="play-forward" size={32} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Bottom Progress Bar with Dual-Layer Buffer & Time Controls */}
            <View style={styles.bottomBar}>
              <TouchableWithoutFeedback onPress={handleProgressBarPress}>
                <View style={styles.progressTouchTarget}>
                  <View style={styles.progressContainer}>
                    {/* Layer 1: Background Gray Track */}
                    <View style={styles.progressTrackBackground} />

                    {/* Layer 2: Buffered Chunks Track */}
                    <View
                      style={[
                        styles.progressBarBuffered,
                        {
                          width: `${
                            durationSec ? Math.min(100, (bufferedSec / durationSec) * 100) : 0
                          }%`,
                        },
                      ]}
                    />

                    {/* Layer 3: Active Playhead Track (Red) */}
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width: `${
                            durationSec ? Math.min(100, (currentTimeSec / durationSec) * 100) : 0
                          }%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              </TouchableWithoutFeedback>

              <View style={styles.timeRow}>
                <Text style={styles.timeText}>
                  {formatTime(currentTimeSec)} / {formatTime(durationSec)}
                </Text>
                <View style={styles.badgeRow}>
                  <Text style={styles.adFreeBadge}>AD-FREE</Text>
                  {/* YouTube Fullscreen Rotation Button */}
                  <TouchableOpacity
                    onPress={toggleFullscreen}
                    style={styles.fullscreenBtn}
                  >
                    <Ionicons
                      name={isFullscreen ? 'contract' : 'scan-outline'}
                      size={20}
                      color="#FFFFFF"
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Animated.View>

        {/* Playback Settings Modal */}
        <Modal
          visible={showSettingsModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSettingsModal(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowSettingsModal(false)}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalSheet,
                  {
                    paddingTop: 16,
                    paddingBottom: Math.max(insets.bottom, 16) + 12,
                    paddingLeft: Math.max(insets.left, 16),
                    paddingRight: Math.max(insets.right, 16),
                    maxHeight: isFullscreen ? '85%' : '75%',
                  },
                ]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalSheetTitle}>Playback Settings / सेटिंग्स</Text>
                  <TouchableOpacity
                    onPress={() => setShowSettingsModal(false)}
                    style={styles.modalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={true}
                  bounces={false}
                >
                  {/* Playback Engine Mode Item */}
                  <TouchableOpacity
                    style={styles.settingsRowItem}
                    onPress={() => {
                      const nextEngine = playerEngine === 'official' ? 'native' : 'official';
                      setPlayerEngine(nextEngine);
                      if (nextEngine === 'official') {
                        try {
                          player.pause();
                        } catch {}
                        webEngineRef.current?.seekTo(currentTimeSec);
                        webEngineRef.current?.play();
                        setIsPlaying(true);
                      } else {
                        try {
                          player.currentTime = currentTimeSec;
                          player.play();
                          setIsPlaying(true);
                        } catch {}
                      }
                    }}
                  >
                    <View style={styles.settingsItemLeft}>
                      <Ionicons name="hardware-chip-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.settingsItemLabel}>Engine / प्लेबैक इंजन</Text>
                    </View>
                    <View style={styles.settingsItemRight}>
                      <Text style={[styles.settingsItemValue, { color: '#00E676', fontWeight: 'bold' }]}>
                        {playerEngine === 'official' ? 'Official 1080p (Zero Freeze)' : 'Native ExoPlayer'}
                      </Text>
                      <Ionicons name="sync-outline" size={16} color="#888888" style={{ marginLeft: 4 }} />
                    </View>
                  </TouchableOpacity>

                  {/* Quality Item */}
                  <TouchableOpacity
                    style={styles.settingsRowItem}
                    onPress={() => {
                      setShowSettingsModal(false);
                      setShowQualityModal(true);
                    }}
                  >
                    <View style={styles.settingsItemLeft}>
                      <Ionicons name="options-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.settingsItemLabel}>Quality / वीडियो क्वालिटी</Text>
                    </View>
                    <View style={styles.settingsItemRight}>
                      <Text style={styles.settingsItemValue}>{activeQuality}</Text>
                      <Ionicons name="chevron-forward" size={16} color="#888888" />
                    </View>
                  </TouchableOpacity>

                  {/* Playback Speed Item */}
                  <TouchableOpacity
                    style={styles.settingsRowItem}
                    onPress={() => {
                      setShowSettingsModal(false);
                      setShowSpeedModal(true);
                    }}
                  >
                    <View style={styles.settingsItemLeft}>
                      <Ionicons name="speedometer-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.settingsItemLabel}>Playback Speed / स्पीड</Text>
                    </View>
                    <View style={styles.settingsItemRight}>
                      <Text style={styles.settingsItemValue}>
                        {currentSpeed === 1.0 ? 'Normal (1x)' : `${currentSpeed}x`}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color="#888888" />
                    </View>
                  </TouchableOpacity>

                  {/* Subtitles / CC Item */}
                  {captionTracks && captionTracks.length > 0 && (
                    <TouchableOpacity
                      style={styles.settingsRowItem}
                      onPress={() => {
                        setShowSettingsModal(false);
                        setShowCaptionModal(true);
                      }}
                    >
                      <View style={styles.settingsItemLeft}>
                        <Ionicons name="chatbox-ellipses-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.settingsItemLabel}>Subtitles / Captions</Text>
                      </View>
                      <View style={styles.settingsItemRight}>
                        <Text style={styles.settingsItemValue}>
                          {selectedCaptionTrackId
                            ? captionTracks.find(c => c.id === selectedCaptionTrackId)?.label || 'On'
                            : 'Off'}
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color="#888888" />
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Audio Track / Language Item */}
                  {audioTracks && audioTracks.length > 1 && (
                    <TouchableOpacity
                      style={styles.settingsRowItem}
                      onPress={() => {
                        setShowSettingsModal(false);
                        setShowAudioModal(true);
                      }}
                    >
                      <View style={styles.settingsItemLeft}>
                        <Ionicons name="language-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.settingsItemLabel}>Audio Track / भाषा</Text>
                      </View>
                      <View style={styles.settingsItemRight}>
                        <Text style={styles.settingsItemValue}>
                          {audioTracks.find(t => t.id === currentAudioTrackId)?.label || 'Default'}
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color="#888888" />
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Audio-only Background Mode */}
                  {audioStreamUrl && (
                    <TouchableOpacity
                      style={styles.settingsRowItem}
                      onPress={() => {
                        setIsAudioOnlyMode(prev => !prev);
                        setShowSettingsModal(false);
                      }}
                    >
                      <View style={styles.settingsItemLeft}>
                        <Ionicons
                          name={isAudioOnlyMode ? 'musical-notes' : 'videocam-outline'}
                          size={20}
                          color="#FFFFFF"
                        />
                        <Text style={styles.settingsItemLabel}>Audio-only Mode / केवल ऑडियो</Text>
                      </View>
                      <View style={styles.settingsItemRight}>
                        <Text
                          style={[
                            styles.settingsItemValue,
                            isAudioOnlyMode ? { color: '#00E676', fontWeight: 'bold' } : null,
                          ]}
                        >
                          {isAudioOnlyMode ? 'On' : 'Off'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Picture-in-Picture (PiP) */}
                  <TouchableOpacity
                    style={styles.settingsRowItem}
                    onPress={() => {
                      setShowSettingsModal(false);
                      handlePictureInPicture();
                    }}
                  >
                    <View style={styles.settingsItemLeft}>
                      <Ionicons name="albums-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.settingsItemLabel}>Picture-in-Picture (PiP)</Text>
                    </View>
                    <View style={styles.settingsItemRight}>
                      <Ionicons name="chevron-forward" size={16} color="#888888" />
                    </View>
                  </TouchableOpacity>


                  {/* Theater Mode (Portrait only) */}
                  {!isFullscreen && (
                    <TouchableOpacity
                      style={styles.settingsRowItem}
                      onPress={() => {
                        setIsTheaterMode(prev => !prev);
                        setShowSettingsModal(false);
                      }}
                    >
                      <View style={styles.settingsItemLeft}>
                        <Ionicons name="tv-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.settingsItemLabel}>Theater Mode / थिएटर मोड</Text>
                      </View>
                      <View style={styles.settingsItemRight}>
                        <Text
                          style={[
                            styles.settingsItemValue,
                            isTheaterMode ? { color: '#FF0000', fontWeight: 'bold' } : null,
                          ]}
                        >
                          {isTheaterMode ? 'On' : 'Off'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </Modal>

        {/* Speed Selector Modal */}
        <Modal
          visible={showSpeedModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSpeedModal(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowSpeedModal(false)}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalSheet,
                  {
                    paddingTop: 16,
                    paddingBottom: Math.max(insets.bottom, 16) + 12,
                    paddingLeft: Math.max(insets.left, 16),
                    paddingRight: Math.max(insets.right, 16),
                    maxHeight: isFullscreen ? '85%' : '72%',
                  },
                ]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalSheetTitle}>Playback Speed</Text>
                  <TouchableOpacity
                    onPress={() => setShowSpeedModal(false)}
                    style={styles.modalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={true}
                  bounces={false}
                >
                  {PLAYBACK_RATES.map(rate => (
                    <TouchableOpacity
                      key={rate}
                      style={[styles.sheetItem, currentSpeed === rate && styles.sheetItemActive]}
                      onPress={() => handleSpeedChange(rate)}
                    >
                      <Text
                        style={[styles.sheetItemText, currentSpeed === rate && styles.sheetItemTextActive]}
                      >
                        {rate === 1.0 ? 'Normal (1.0x)' : `${rate}x`}
                      </Text>
                      {currentSpeed === rate && (
                        <Ionicons name="checkmark" size={20} color="#FF0000" />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </Modal>

        {/* Quality Selector Modal */}
        <Modal
          visible={showQualityModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowQualityModal(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowQualityModal(false)}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalSheet,
                  {
                    paddingTop: 16,
                    paddingBottom: Math.max(insets.bottom, 16) + 12,
                    paddingLeft: Math.max(insets.left, 16),
                    paddingRight: Math.max(insets.right, 16),
                    maxHeight: isFullscreen ? '85%' : '72%',
                  },
                ]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalSheetTitle}>Select Video Quality</Text>
                  <TouchableOpacity
                    onPress={() => setShowQualityModal(false)}
                    style={styles.modalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={true}
                  bounces={false}
                >
                  {(() => {
                    const displayQualities =
                      playerEngine === 'official' && availableQualities.length <= 2
                        ? [
                            { qualityLabel: '1080p HD', url: '', hasVideo: true, hasAudio: true },
                            { qualityLabel: '720p HD', url: '', hasVideo: true, hasAudio: true },
                            { qualityLabel: '480p', url: '', hasVideo: true, hasAudio: true },
                            { qualityLabel: '360p', url: '', hasVideo: true, hasAudio: true },
                            { qualityLabel: '240p', url: '', hasVideo: true, hasAudio: true },
                            { qualityLabel: 'Auto', url: '', hasVideo: true, hasAudio: true },
                          ]
                        : availableQualities;

                    return displayQualities.map((item, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.sheetItem,
                          activeQuality === item.qualityLabel && styles.sheetItemActive,
                        ]}
                        onPress={() => handleQualitySelect(item)}
                      >
                        <View style={styles.qualityLabelContainer}>
                          <Text
                            style={[
                              styles.sheetItemText,
                              activeQuality === item.qualityLabel && styles.sheetItemTextActive,
                            ]}
                          >
                            {item.qualityLabel}
                          </Text>
                          {item.qualityLabel.includes('1080') || item.qualityLabel.includes('1440') || item.qualityLabel.includes('2160') ? (
                            <View style={styles.hdBadge}>
                              <Text style={styles.hdBadgeText}>
                                {item.qualityLabel.includes('2160') ? '4K' : 'HD'}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {activeQuality === item.qualityLabel && (
                          <Ionicons name="checkmark" size={20} color="#FF0000" />
                        )}
                      </TouchableOpacity>
                    ));
                  })()}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </Modal>

        {/* Audio Track / Language Selector Modal */}
        <Modal
          visible={showAudioModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAudioModal(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowAudioModal(false)}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalSheet,
                  {
                    paddingTop: 16,
                    paddingBottom: Math.max(insets.bottom, 16) + 12,
                    paddingLeft: Math.max(insets.left, 16),
                    paddingRight: Math.max(insets.right, 16),
                    maxHeight: isFullscreen ? '85%' : '72%',
                  },
                ]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalSheetTitle}>Audio Track / भाषा</Text>
                  <TouchableOpacity
                    onPress={() => setShowAudioModal(false)}
                    style={styles.modalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={true}
                  bounces={false}
                >
                  {audioTracks.map((item, idx) => {
                    const isSelected =
                      currentAudioTrackId === item.id ||
                      (!currentAudioTrackId && item.isDefault);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.sheetItem,
                          isSelected && styles.sheetItemActive,
                        ]}
                        onPress={() => handleAudioTrackSelect(item)}
                      >
                        <View style={styles.qualityLabelContainer}>
                          <Text
                            style={[
                              styles.sheetItemText,
                              isSelected && styles.sheetItemTextActive,
                            ]}
                          >
                            {item.label}
                          </Text>
                          {item.isDefault && (
                            <View style={styles.hdBadge}>
                              <Text style={styles.hdBadgeText}>ORIGINAL</Text>
                            </View>
                          )}
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color="#FF0000" />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </Modal>

        {/* Subtitle / Closed Caption Selector Modal */}
        <Modal
          visible={showCaptionModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCaptionModal(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowCaptionModal(false)}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalSheet,
                  {
                    paddingTop: 16,
                    paddingBottom: Math.max(insets.bottom, 16) + 12,
                    paddingLeft: Math.max(insets.left, 16),
                    paddingRight: Math.max(insets.right, 16),
                    maxHeight: isFullscreen ? '85%' : '72%',
                  },
                ]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalSheetTitle}>Subtitles / Closed Captions</Text>
                  <TouchableOpacity
                    onPress={() => setShowCaptionModal(false)}
                    style={styles.modalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={true}
                  bounces={false}
                >
                  {/* Option to Turn Off */}
                  <TouchableOpacity
                    style={[
                      styles.sheetItem,
                      selectedCaptionTrackId === null && styles.sheetItemActive,
                    ]}
                    onPress={() => handleCaptionTrackSelect(null)}
                  >
                    <Text
                      style={[
                        styles.sheetItemText,
                        selectedCaptionTrackId === null && styles.sheetItemTextActive,
                      ]}
                    >
                      Turn off captions (बंद करें)
                    </Text>
                    {selectedCaptionTrackId === null && (
                      <Ionicons name="checkmark" size={20} color="#FF0000" />
                    )}
                  </TouchableOpacity>

                  {/* List of Available Subtitle Tracks */}
                  {captionTracks.map((track, idx) => {
                    const isSelected = selectedCaptionTrackId === track.id;
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[styles.sheetItem, isSelected && styles.sheetItemActive]}
                        onPress={() => handleCaptionTrackSelect(track)}
                      >
                        <View style={styles.qualityLabelContainer}>
                          <Text
                            style={[
                              styles.sheetItemText,
                              isSelected && styles.sheetItemTextActive,
                            ]}
                          >
                            {track.label}
                          </Text>
                          {track.isAutoGenerated && (
                            <View style={styles.autoBadge}>
                              <Text style={styles.autoBadgeText}>AUTO</Text>
                            </View>
                          )}
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color="#FF0000" />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </Modal>
      </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
  },
  fullscreenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 9999,
    backgroundColor: '#000000',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  audioModeContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  audioModeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
  },
  audioModeSub: {
    color: '#888888',
    fontSize: 12,
    marginTop: 4,
  },
  subtitleContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  subtitleContainerFullscreen: {
    bottom: 60,
  },
  subtitleContainerShifted: {
    bottom: 70,
  },
  subtitleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doubleTapOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '35%',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 50,
  },
  doubleTapLeft: {
    left: 0,
  },
  doubleTapRight: {
    right: 0,
  },
  doubleTapText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 4,
  },
  sponsorNotice: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00E676',
    zIndex: 50,
  },
  sponsorNoticeText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  videoTitle: {
    flex: 1,
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
  },
  topActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  topActionBtnActive: {
    backgroundColor: '#FF0000',
  },
  topActionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  qualityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  qualityText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  settingsTopBtn: {
    padding: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingsItemLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  settingsItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingsItemValue: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  centerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
  },
  playPauseBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 30,
  },
  iconButton: {
    padding: 10,
  },
  bottomBar: {
    width: '100%',
    zIndex: 15,
  },
  progressTouchTarget: {
    paddingVertical: 12,
  },
  progressContainer: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  progressTrackBackground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  progressBarBuffered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#FF0000',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  timeText: {
    color: '#E0E0E0',
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adFreeBadge: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 10,
  },
  fullscreenBtn: {
    padding: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1C1C24',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalSheetTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  modalScrollView: {
    maxHeight: 340,
  },
  modalScrollContent: {
    paddingBottom: 8,
  },
  sheetItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2C',
  },
  sheetItemActive: {
    backgroundColor: 'rgba(255, 0, 0, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  qualityLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetItemText: {
    color: '#E0E0E0',
    fontSize: 14,
  },
  sheetItemTextActive: {
    color: '#FF0000',
    fontWeight: 'bold',
  },
  hdBadge: {
    backgroundColor: '#FF0000',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 8,
  },
  hdBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  autoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 8,
  },
  autoBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  autoplaySwitchBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  autoplayTrack: {
    width: 32,
    height: 18,
    borderRadius: 10,
    backgroundColor: '#333333',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: '#555555',
  },
  autoplayTrackActive: {
    backgroundColor: '#CC0000',
    borderColor: '#FF0000',
  },
  autoplayThumb: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#888888',
  },
  autoplayThumbActive: {
    backgroundColor: '#FFFFFF',
  },
  autoplayThumbInactive: {
    backgroundColor: '#888888',
  },
  toastNotice: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 250,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  toastNoticeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  endedOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 150,
    padding: 16,
  },
  upNextCard: {
    backgroundColor: '#1E1E26',
    borderRadius: 12,
    padding: 16,
    width: '90%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  upNextHeader: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  upNextDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  upNextThumb: {
    width: 80,
    height: 50,
    borderRadius: 6,
    backgroundColor: '#2A2A35',
    marginRight: 12,
  },
  upNextMeta: {
    flex: 1,
  },
  upNextTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  upNextAuthor: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  upNextActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelAutoplayBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelAutoplayText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  playNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#FF0000',
  },
  playNowText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  replayContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  replayText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  manualNextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(30, 30, 38, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    maxWidth: '85%',
  },
  manualNextText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  zoomToast: {
    position: 'absolute',
    top: 54,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    zIndex: 70,
    gap: 6,
  },
  zoomToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  resetZoomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF0000',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  resetZoomText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
