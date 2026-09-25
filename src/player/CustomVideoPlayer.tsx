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
import * as ScreenOrientation from 'expo-screen-orientation';
import { fetchSponsorSegments, checkAndGetSkipPosition, SponsorSegment } from '../api/sponsorBlock';
import { saveWatchProgress } from '../database/repositories/historyRepo';
import { configureBackgroundAudio } from './audioMode';
import { StreamFormatOption, AudioTrackOption, CaptionTrackOption } from '../api/types';
import { createDashManifestFile, DashFormatInfo } from './dashManifestBuilder';
import { fetchSubtitleCues, getCurrentSubtitleText, SubtitleCue } from './subtitleService';

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
}) => {
  const videoViewRef = useRef<VideoView>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [durationSec, setDurationSec] = useState<number>(0);
  const [bufferedSec, setBufferedSec] = useState<number>(0);
  const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
  const [sponsorSkippedNotice, setSponsorSkippedNotice] = useState<string | null>(null);

  // Quality, Fullscreen & Theater states
  const [activeQuality, setActiveQuality] = useState<string>(qualityLabel);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);
  const [contentFit, setContentFit] = useState<VideoContentFit>('contain');

  // Double tap seeking indicators
  const [doubleTapSide, setDoubleTapSide] = useState<'left' | 'right' | null>(null);
  const doubleTapAnim = useMemo(() => new Animated.Value(0), []);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // Audio-only mode
  const [isAudioOnlyMode, setIsAudioOnlyMode] = useState<boolean>(false);

  // Settings Modals
  const [showSpeedModal, setShowSpeedModal] = useState<boolean>(false);
  const [showQualityModal, setShowQualityModal] = useState<boolean>(false);
  const [showAudioModal, setShowAudioModal] = useState<boolean>(false);
  const [showCaptionModal, setShowCaptionModal] = useState<boolean>(false);
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

  const activeSourceUrl = isAudioOnlyMode && audioStreamUrl ? audioStreamUrl : streamUrl;
  const isDashSource = typeof activeSourceUrl === 'string' && activeSourceUrl.endsWith('.mpd');

  // Stable initial source using useMemo with empty dependencies:
  // Runs only once on mount so useVideoPlayer is never triggered by orientation/quality re-renders.
  // All subsequent stream changes are controlled strictly via player.replaceAsync() and pendingSeekPositionRef.
  const initialSource: VideoSource = useMemo(() => {
    if (!activeSourceUrl) return null;
    return isDashSource ? { uri: activeSourceUrl, contentType: 'dash' as ContentType } : activeSourceUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize Modern Expo Video Player
  const player = useVideoPlayer(initialSource, p => {
    p.loop = false;
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
    p.timeUpdateEventInterval = 0.5;
    p.playbackRate = currentSpeed;
    p.play();
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
    const resumePos = player.currentTime || lastKnownPositionRef.current || 0;
    const isDash = targetUri.endsWith('.mpd');
    const newSource: any = isDash ? { uri: targetUri, contentType: 'dash' } : targetUri;

    player.replaceAsync(newSource).then(() => {
      if (resumePos > 0) {
        player.currentTime = resumePos;
      }
      player.play();
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
    });

    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Player Events (Playing status, Time update, Subtitle sync, Buffer & History)
  useEffect(() => {
    if (!player) return;

    const playingSub = player.addListener('playingChange', event => {
      setIsPlaying(event.isPlaying);
    });

    const statusSub = player.addListener('statusChange', event => {
      setIsLoading(event.status === 'loading');
      if (event.status === 'readyToPlay' && pendingSeekPositionRef.current > 0) {
        const target = pendingSeekPositionRef.current;
        pendingSeekPositionRef.current = 0;
        player.currentTime = target;
        lastKnownPositionRef.current = target;
        player.play();
      }
    });

    const sourceLoadSub = player.addListener('sourceLoad', () => {
      if (pendingSeekPositionRef.current > 0) {
        const target = pendingSeekPositionRef.current;
        pendingSeekPositionRef.current = 0;
        player.currentTime = target;
        lastKnownPositionRef.current = target;
        player.play();
      }
    });

    const timeSub = player.addListener('timeUpdate', event => {
      const cur = event.currentTime;
      const dur = player.duration || 0;
      setCurrentTimeSec(cur);
      setDurationSec(dur);
      lastKnownPositionRef.current = cur;

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

      // Save watch history periodically
      if (cur > 3 && dur > 0) {
        saveWatchProgress(
          videoId,
          title,
          author,
          thumbnailUrl,
          Math.floor(cur * 1000),
          Math.floor(dur * 1000)
        );
      }

      // SponsorBlock Auto-Skip check
      const targetSkipSeconds = checkAndGetSkipPosition(cur, sponsorSegments);
      if (targetSkipSeconds !== null) {
        player.currentTime = targetSkipSeconds;
        lastKnownPositionRef.current = targetSkipSeconds;
        setSponsorSkippedNotice('Skipped Sponsor Segment');
        setTimeout(() => setSponsorSkippedNotice(null), 2500);
      }
    });

    return () => {
      playingSub.remove();
      statusSub.remove();
      sourceLoadSub.remove();
      timeSub.remove();
    };
  }, [player, videoId, title, author, thumbnailUrl, sponsorSegments, selectedCaptionTrackId, currentSubtitleText]);

  // Auto-hide controls after 4 seconds of inactivity
  useEffect(() => {
    let timer: any;
    if (showControls && isPlaying) {
      timer = setTimeout(() => {
        setShowControls(false);
      }, 4000);
    }
    return () => clearTimeout(timer);
  }, [showControls, isPlaying]);

  const togglePlayPause = () => {
    if (!player) return;

    const shouldPlay = !player.playing;
    if (shouldPlay) {
      player.play();
    } else {
      player.pause();
    }
    setIsPlaying(shouldPlay);
  };

  const seekRelative = (offsetSec: number) => {
    if (!player) return;
    player.seekBy(offsetSec);
    lastKnownPositionRef.current = Math.max(0, (player.currentTime || 0) + offsetSec);
  };

  // YouTube-style Fullscreen Toggle
  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setIsFullscreen(true);
        onFullscreenChange?.(true);
      } else {
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

  // YouTube-style Quality Selector with Exact Timestamp Resume (No Restarting, No Black Screen)
  const handleQualitySelect = async (item: StreamFormatOption) => {
    setShowQualityModal(false);
    setIsLoading(true);
    try {
      const resumePos = player?.currentTime || lastKnownPositionRef.current || 0;
      pendingSeekPositionRef.current = resumePos;
      let newSource: any = item.url;
      let newSourceUri = item.url;

      if (!item.hasAudio && rawVideoFormats.length > 0 && rawAudioFormats.length > 0) {
        const mpdUri = await createDashManifestFile(
          videoId,
          durationSec,
          rawVideoFormats,
          rawAudioFormats,
          item.qualityLabel,
          currentAudioTrackId
        );
        if (mpdUri) {
          newSource = { uri: mpdUri, contentType: 'dash' };
          newSourceUri = mpdUri;
        }
      }

      // Mark the loaded source URI to prevent double replace from parent re-render
      loadedSourceUriRef.current = newSourceUri;

      if (player) {
        await player.replaceAsync(newSource);
        if (resumePos > 0) {
          // eslint-disable-next-line react-hooks/immutability -- expo-video player is a mutable imperative API
          player.currentTime = resumePos;
          lastKnownPositionRef.current = resumePos;
        }
        pendingSeekPositionRef.current = 0;
        player.play();
      }

      setActiveQuality(item.qualityLabel);
      onQualityChange?.(newSourceUri, item.qualityLabel);
    } catch (err) {
      console.warn('Quality change error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // YouTube Multi-Language Audio Track Selector
  const handleAudioTrackSelect = async (track: AudioTrackOption) => {
    setShowAudioModal(false);
    setIsLoading(true);
    try {
      const resumePos = player?.currentTime || lastKnownPositionRef.current || 0;
      pendingSeekPositionRef.current = resumePos;
      let newSource: any = track.url || streamUrl;
      let newSourceUri: string = track.url || streamUrl;

      // Build DASH manifest for video + selected audio track
      if (rawVideoFormats.length > 0 && rawAudioFormats.length > 0) {
        const mpdUri = await createDashManifestFile(
          videoId,
          durationSec,
          rawVideoFormats,
          rawAudioFormats,
          activeQuality,
          track.id
        );
        if (mpdUri) {
          newSource = { uri: mpdUri, contentType: 'dash' };
          newSourceUri = mpdUri;
        }
      }

      loadedSourceUriRef.current = newSourceUri;

      if (player) {
        await player.replaceAsync(newSource);
        if (resumePos > 0) {
          // eslint-disable-next-line react-hooks/immutability -- expo-video player is a mutable imperative API
          player.currentTime = resumePos;
          lastKnownPositionRef.current = resumePos;
        }
        player.play();
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

  // YouTube Double-Tap to Seek Handler
  const handleTap = (e: any) => {
    // eslint-disable-next-line react-hooks/purity -- event handlers are intentionally impure
    const now = Date.now();
    const { locationX } = e.nativeEvent;
    const windowWidth = Dimensions.get('window').width;

    if (now - lastTapRef.current.time < 300) {
      if (locationX < windowWidth * 0.38) {
        seekRelative(-10);
        triggerDoubleTapAnimation('left');
      } else if (locationX > windowWidth * 0.62) {
        seekRelative(10);
        triggerDoubleTapAnimation('right');
      } else {
        setShowControls(prev => !prev);
      }
    } else {
      setShowControls(prev => !prev);
    }

    lastTapRef.current = { time: now, x: locationX };
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
    if (!player || durationSec <= 0) return;
    const { locationX } = e.nativeEvent;
    const barWidth = Dimensions.get('window').width - 32;
    const ratio = Math.max(0, Math.min(1, locationX / barWidth));
    const targetSec = ratio * durationSec;
    const curPos = player.currentTime || 0;
    player.seekBy(targetSec - curPos);
    lastKnownPositionRef.current = targetSec;
    setCurrentTimeSec(targetSec);
  };

  const handleSpeedChange = (speed: number) => {
    if (!player) return;
    // eslint-disable-next-line react-hooks/immutability -- expo-video player is a mutable imperative API
    player.playbackRate = speed;
    setCurrentSpeed(speed);
    setShowSpeedModal(false);
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
    <TouchableWithoutFeedback onPress={handleTap}>
      <View
        style={[
          styles.container,
          { height: containerHeight },
          isFullscreen && styles.fullscreenContainer,
        ]}
      >
        <StatusBar hidden={isFullscreen} />

        {/* Video or Audio-Mode View */}
        {isAudioOnlyMode ? (
          <View style={styles.audioModeContainer}>
            <Ionicons name="musical-notes" size={48} color="#FF0000" />
            <Text style={styles.audioModeText}>Background Audio Mode Active</Text>
            <Text style={styles.audioModeSub}>Display off for maximum battery saving</Text>
          </View>
        ) : (
          <VideoView
            ref={videoViewRef}
            player={player}
            style={styles.videoPlayer}
            contentFit={contentFit}
            nativeControls={false}
            allowsPictureInPicture={true}
            startsPictureInPictureAutomatically={true}
          />
        )}

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
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#FF0000" />
          </View>
        )}

        {/* Sponsor Skip Alert */}
        {sponsorSkippedNotice && (
          <View style={styles.sponsorNotice}>
            <Ionicons name="shield-checkmark" size={16} color="#00E676" />
            <Text style={styles.sponsorNoticeText}>{sponsorSkippedNotice}</Text>
          </View>
        )}

        {/* Custom Controls Overlay */}
        {showControls && (
          <View style={styles.overlay}>
            {/* Top Bar with All YouTube Controls */}
            <View style={styles.topBar}>
              <TouchableOpacity
                onPress={isFullscreen ? toggleFullscreen : onClose}
                style={styles.iconButton}
              >
                <Ionicons
                  name={isFullscreen ? 'arrow-back' : 'chevron-down'}
                  size={26}
                  color="#FFFFFF"
                />
              </TouchableOpacity>
              <Text style={styles.videoTitle} numberOfLines={1}>
                {title}
              </Text>

              {/* Subtitles (CC) Button */}
              {captionTracks && captionTracks.length > 0 && (
                <TouchableOpacity
                  onPress={() => setShowCaptionModal(true)}
                  style={[
                    styles.topActionBtn,
                    selectedCaptionTrackId ? styles.topActionBtnActive : null,
                  ]}
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
                onPress={() => setContentFit(prev => (prev === 'contain' ? 'cover' : 'contain'))}
                style={styles.topActionBtn}
              >
                <Ionicons
                  name={contentFit === 'cover' ? 'contract-outline' : 'expand-outline'}
                  size={18}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              {/* Theater Mode Toggle (in Portrait) */}
              {!isFullscreen && (
                <TouchableOpacity
                  onPress={() => setIsTheaterMode(prev => !prev)}
                  style={[styles.topActionBtn, isTheaterMode && styles.topActionBtnActive]}
                >
                  <Ionicons name="tv-outline" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {/* Picture-in-Picture Button */}
              <TouchableOpacity
                onPress={handlePictureInPicture}
                style={styles.topActionBtn}
              >
                <Ionicons name="albums-outline" size={18} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Audio Mode Toggle */}
              {audioStreamUrl && (
                <TouchableOpacity
                  onPress={() => setIsAudioOnlyMode(prev => !prev)}
                  style={[styles.topActionBtn, isAudioOnlyMode && styles.topActionBtnActive]}
                >
                  <Ionicons
                    name={isAudioOnlyMode ? 'musical-notes' : 'videocam-outline'}
                    size={18}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              )}

              {/* Audio Track / Language Selector Button */}
              {audioTracks && audioTracks.length > 1 && (
                <TouchableOpacity
                  onPress={() => setShowAudioModal(true)}
                  style={styles.topActionBtn}
                >
                  <Ionicons name="language-outline" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {/* Speed Button */}
              <TouchableOpacity
                onPress={() => setShowSpeedModal(true)}
                style={styles.topActionBtn}
              >
                <Text style={styles.topActionBtnText}>{currentSpeed}x</Text>
              </TouchableOpacity>

              {/* Quality Button */}
              <TouchableOpacity
                onPress={() => setShowQualityModal(true)}
                style={styles.qualityBadge}
              >
                <Text style={styles.qualityText}>{activeQuality}</Text>
              </TouchableOpacity>
            </View>

            {/* Center Playback Controls */}
            <View style={styles.centerControls}>
              <TouchableOpacity onPress={() => seekRelative(-10)} style={styles.iconButton}>
                <Ionicons name="play-back" size={32} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity onPress={togglePlayPause} style={styles.playPauseBtn}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={36}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => seekRelative(10)} style={styles.iconButton}>
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
          </View>
        )}

        {/* Speed Selector Modal */}
        <Modal visible={showSpeedModal} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowSpeedModal(false)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalSheetTitle}>Playback Speed</Text>
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
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Quality Selector Modal */}
        <Modal visible={showQualityModal} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowQualityModal(false)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalSheetTitle}>Select Video Quality</Text>
              {availableQualities.map((item, idx) => (
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
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Audio Track / Language Selector Modal */}
        <Modal visible={showAudioModal} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowAudioModal(false)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalSheetTitle}>Audio Track / भाषा</Text>
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
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Subtitle / Closed Caption Selector Modal */}
        <Modal visible={showCaptionModal} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowCaptionModal(false)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalSheetTitle}>Subtitles / Closed Captions</Text>
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
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </TouchableWithoutFeedback>
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
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    justifyContent: 'space-between',
    padding: 12,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  videoTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  topActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginLeft: 6,
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
    marginLeft: 6,
  },
  qualityText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  centerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 28,
  },
  iconButton: {
    padding: 6,
  },
  bottomBar: {
    width: '100%',
  },
  progressTouchTarget: {
    paddingVertical: 8,
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 18,
    maxHeight: '70%',
  },
  modalSheetTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 14,
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
});
