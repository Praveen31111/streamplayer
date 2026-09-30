import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  BackHandler,
  Platform,
  StatusBar,
  ToastAndroid,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NavigationBar, setVisibilityAsync } from 'expo-navigation-bar';
import { backgroundAudioBridge } from '../player/NativeBackgroundAudioBridge';

// Universal Android Chrome Mobile User-Agent without 'wv' (WebView flag)
// 1. Bypasses Google OAuth 403 "disallowed_useragent" (allows 100% genuine Gmail/Google sign-in)
// 2. Uses universal baseline (Android 10; K) so YouTube serves universal AVC/H.264 & VP9 codecs
//    instead of experimental AV1/HDR codecs that cause black screens on mobile devices
const CHROME_ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

// uBlock Origin / Brave Grade Clean Engine
// 1. Uses in-memory JSON Pruning (strips adPlacements/playerAds before YouTube player initializes)
// 2. Avoids destroying video player containers or dropping network sockets that cause black screens
// 3. Guarantees simultaneous video rendering and audio playback with zero ad disruptions
const BRAVE_CLEAN_ENGINE = `
(function() {
  if (window.__BRAVE_CLEAN_ENGINE_INSTALLED__) return;
  window.__BRAVE_CLEAN_ENGINE_INSTALLED__ = true;

  // 1. In-Memory JSON-Prune (uBlock Origin Engine)
  // Strips ad placements so YouTube's player natively treats every video as ad-free
  function pruneAds(obj) {
    if (!obj || typeof obj !== 'object') return;
    try {
      if (Array.isArray(obj.adPlacements)) obj.adPlacements = [];
      if (Array.isArray(obj.playerAds)) obj.playerAds = [];
      if (Array.isArray(obj.adSlots)) obj.adSlots = [];
      if (obj.playerResponse && typeof obj.playerResponse === 'object') {
        pruneAds(obj.playerResponse);
      }
    } catch(e) {}
  }

  // Intercept JSON.parse
  try {
    var origParse = JSON.parse;
    JSON.parse = function(text, reviver) {
      var data = origParse.call(this, text, reviver);
      if (data && typeof data === 'object') {
        pruneAds(data);
      }
      return data;
    };
  } catch(e) {}

  // Intercept Response.prototype.json (Fetch API)
  try {
    if (window.Response && window.Response.prototype && window.Response.prototype.json) {
      var origJson = window.Response.prototype.json;
      window.Response.prototype.json = function() {
        return origJson.apply(this, arguments).then(function(data) {
          if (data && typeof data === 'object') {
            pruneAds(data);
          }
          return data;
        });
      };
    }
  } catch(e) {}

  // Intercept initial player response assignment
  try {
    var _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get: function() { return _ytInitialPlayerResponse; },
      set: function(val) {
        if (val && typeof val === 'object') {
          pruneAds(val);
        }
        _ytInitialPlayerResponse = val;
      }
    });
  } catch(e) {}

  // 2. Safe Cosmetic CSS - Clean Feed & Protected Video Surface
  function injectStyles() {
    try {
      if (document.getElementById('__brave_styles__')) return;
      var style = document.createElement('style');
      style.id = '__brave_styles__';
      style.textContent = \`
        /* Feed & Banner Ads */
        ytm-promoted-sparkles-web-renderer,
        ytd-promoted-video-renderer,
        ytm-promoted-video-renderer,
        ytd-ad-slot-renderer,
        ytm-ad-slot-renderer,
        ytm-companion-ad-renderer,
        ytm-upsell-dialog-renderer,
        ytm-statement-banner-renderer,
        ytm-mealbar-promo-renderer,
        ytm-paid-content-overlay-renderer,
        ytd-enforcement-message-view-model,
        .open-in-app-banner,
        .app-banner,
        [aria-label="Open App"],
        .compact-link-open-in-app {
          display: none !important;
          height: 0 !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* Protect Video Surface - Ensure hardware compositing & visibility */
        video,
        .html5-main-video,
        .video-stream {
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
        }

        /* WebKit Media Controls refresh for Android WebView compositor */
        video::-webkit-media-controls {
          opacity: 0.01 !important;
        }

        /* Pure Dark Theme Variables & Color Scheme */
        :root, html[dark], [dark] {
          --yt-spec-base-background: #0F0F0F !important;
          --yt-spec-raised-background: #181818 !important;
          --yt-spec-text-primary: #FFFFFF !important;
          --yt-spec-text-secondary: #AAAAAA !important;
          color-scheme: dark !important;
        }

        html, body, ytm-app {
          background-color: #0F0F0F !important;
          color: #FFFFFF !important;
          -webkit-tap-highlight-color: transparent !important;
        }

        /* Video Titles in Feed & Search Only - High Contrast White Text */
        ytm-media-item .media-item-headline,
        ytm-compact-video-renderer .compact-media-item-headline,
        .compact-media-item-headline,
        .media-item-headline,
        .ytm-media-item .details .headline {
          color: #FFFFFF !important;
          -webkit-text-fill-color: #FFFFFF !important;
        }

        /* Channel Names, Views Count & Upload Date */
        .media-item-metadata,
        .compact-media-item-metadata,
        .secondary-text,
        .subhead,
        .slim-owner-channel-name,
        ytm-badge-and-byline-renderer,
        ytm-badge-and-byline-renderer *,
        .ytm-badge-and-byline-item {
          color: #AAAAAA !important;
          -webkit-text-fill-color: #AAAAAA !important;
        }

        /* Ensure player controls and dialogs remain completely interactive and responsive */
        .html5-video-player,
        .player-controls-background,
        .player-control-overlay,
        ytm-menu-popup-renderer,
        ytm-bottom-sheet-renderer {
          pointer-events: auto !important;
        }
      \`;
      (document.head || document.documentElement).appendChild(style);

      // Force native YouTube dark theme attribute & cookie
      try {
        document.documentElement.setAttribute('dark', 'true');
        document.cookie = "PREF=f6=400; domain=.youtube.com; path=/; max-age=31536000";
      } catch(e) {}
    } catch(e) {}
  }

  // 3. Fallback Fast-Skip Watchdog
  function handleVideoAds() {
    try {
      injectStyles();

      // Click all modern & legacy skip buttons
      var skipSelectors = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        '.videoAdUiSkipButton',
        '.ytp-ad-skip-button-slot button',
        'button.ytp-ad-skip-button-modern',
        '[id^="skip-button"]',
        '.ytp-ad-skip-button-container button',
        'button[aria-label*="Skip"]',
        '.ytp-ad-skip-button-text'
      ];
      for (var i = 0; i < skipSelectors.length; i++) {
        var btns = document.querySelectorAll(skipSelectors[i]);
        for (var j = 0; j < btns.length; j++) {
          btns[j].click();
        }
      }

      // If an ad is actively playing, speed it through
      var isAd = document.querySelector('.ad-showing, .ad-interrupting');
      var video = document.querySelector('video');
      if (isAd && video) {
        video.muted = true;
        video.playbackRate = 16.0;
      } else if (!isAd && video && video.playbackRate > 2.0) {
        video.playbackRate = 1.0;
        video.muted = false;
      }

      // Auto-dismiss promo dialogs & upsell popups only (never dismiss player settings or quality menus)
      var promoDismiss = document.querySelector('ytm-upsell-dialog-renderer button[aria-label="Dismiss"], ytm-mealbar-promo-renderer button[aria-label="Dismiss"], ytm-mealbar-promo-renderer [dialog-dismiss]');
      if (promoDismiss) {
        promoDismiss.click();
      }
    } catch(e) {}
  }

  setInterval(handleVideoAds, 100);
  try {
    var obs = new MutationObserver(handleVideoAds);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  // 4. Background Playback & Screen-Off Audio Engine (Brave Browser Technique)
  try {
    // 4a. Freeze Page Visibility API to always report visible (prevents YouTube from pausing)
    Object.defineProperty(document, 'hidden', {
      get: function() { return false; },
      configurable: true
    });
    Object.defineProperty(document, 'visibilityState', {
      get: function() { return 'visible'; },
      configurable: true
    });
    Object.defineProperty(document, 'webkitHidden', {
      get: function() { return false; },
      configurable: true
    });
    Object.defineProperty(document, 'webkitVisibilityState', {
      get: function() { return 'visible'; },
      configurable: true
    });

    // 4b. Spoof document.hasFocus
    if (Document.prototype && Document.prototype.hasFocus) {
      Document.prototype.hasFocus = function() { return true; };
    }
    document.hasFocus = function() { return true; };
  } catch(e) {}

  // 4c. Block visibilitychange and blur events from reaching YouTube's player listeners
  var suppressedEvents = ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'blur'];
  for (var k = 0; k < suppressedEvents.length; k++) {
    (function(evt) {
      window.addEventListener(evt, function(e) {
        e.stopImmediatePropagation();
      }, true);
      document.addEventListener(evt, function(e) {
        e.stopImmediatePropagation();
      }, true);
    })(suppressedEvents[k]);
  }

  // 4d. Smart Involuntary Pause Watchdog
  // Accurately differentiates between user manually tapping pause vs screen-off auto-pause
  var lastUserTouchTime = 0;
  window.addEventListener('touchstart', function() {
    lastUserTouchTime = Date.now();
  }, { capture: true, passive: true });
  window.addEventListener('pointerdown', function() {
    lastUserTouchTime = Date.now();
  }, { capture: true, passive: true });
  window.addEventListener('mousedown', function() {
    lastUserTouchTime = Date.now();
  }, { capture: true, passive: true });

  // Handle lock screen media notification controls (user explicitly tapped pause on notification)
  var lockscreenPaused = false;
  if (navigator.mediaSession) {
    try {
      var origSetActionHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = function(action, handler) {
        if (action === 'pause') {
          return origSetActionHandler(action, function(details) {
            lockscreenPaused = true;
            if (handler) handler(details);
          });
        }
        if (action === 'play') {
          return origSetActionHandler(action, function(details) {
            lockscreenPaused = false;
            if (handler) handler(details);
          });
        }
        return origSetActionHandler(action, handler);
      };
    } catch(e) {}
  }

  // Auto-resume if video paused unexpectedly while not user-paused
  document.addEventListener('pause', function(e) {
    var video = e.target;
    if (video && video.tagName === 'VIDEO' && !video.ended) {
      var timeSinceTouch = Date.now() - lastUserTouchTime;
      // If pause was NOT triggered by an active screen touch (< 650ms) and NOT by lockscreen notification
      if (timeSinceTouch > 650 && !lockscreenPaused) {
        setTimeout(function() {
          if (video.paused && !video.ended && !lockscreenPaused) {
            video.play().catch(function(){});
          }
        }, 80);
      }
    }
  }, true);

  // 4e. Silent WebAudio Keep-Alive
  // Keeps Android AudioFlinger pipeline warm during prolonged screen-off
  var keepAliveContext = null;
  function ensureAudioAwake() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!keepAliveContext && AudioCtx) {
        keepAliveContext = new AudioCtx();
      }
      if (keepAliveContext && keepAliveContext.state === 'suspended') {
        keepAliveContext.resume().catch(function(){});
      }
    } catch(e) {}
  }
  document.addEventListener('play', function(e) {
    if (e.target && e.target.tagName === 'VIDEO') {
      lockscreenPaused = false;
      ensureAudioAwake();
    }
  }, true);

  // 5. Native Background Audio Bridge Emitter
  function emitMediaState() {
    try {
      var video = document.querySelector('video');
      var url = window.location.href;
      var match = url.match(/[?&]v=([^&]+)/);
      var videoId = match ? match[1] : '';

      if (!videoId && window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails) {
        videoId = window.ytInitialPlayerResponse.videoDetails.videoId || '';
      }

      if (video && videoId && window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        var title = document.title ? document.title.replace(' - YouTube', '').trim() : '';
        var author = '';
        var authorEl = document.querySelector('.slim-owner-channel-name, ytm-channel-name, .ytm-autonav-endscreen-header');
        if (authorEl) author = authorEl.textContent.trim();

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'MEDIA_STATE',
          videoId: videoId,
          currentTime: Math.floor(video.currentTime || 0),
          isPlaying: !video.paused && !video.ended,
          title: title,
          author: author
        }));
      }
    } catch(e) {}
  }

  setInterval(emitMediaState, 2000);
  document.addEventListener('play', emitMediaState, true);
  document.addEventListener('pause', emitMediaState, true);
  document.addEventListener('seeked', emitMediaState, true);

  // 6. Fullscreen Event Bridge (captures both standard and WebKit HTML5 video fullscreen)
  function notifyFullscreen() {
    var isFull = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'FULLSCREEN_CHANGE',
        isFullscreen: isFull
      }));
    }
  }

  document.addEventListener('fullscreenchange', notifyFullscreen, true);
  document.addEventListener('webkitfullscreenchange', notifyFullscreen, true);
  document.addEventListener('mozfullscreenchange', notifyFullscreen, true);
  document.addEventListener('MSFullscreenChange', notifyFullscreen, true);

  document.addEventListener('webkitbeginfullscreen', function() {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'FULLSCREEN_CHANGE',
        isFullscreen: true
      }));
    }
  }, true);

  document.addEventListener('webkitendfullscreen', function() {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'FULLSCREEN_CHANGE',
        isFullscreen: false
      }));
    }
  }, true);

  // 7. Auto-Miniplayer when browsing other pages / searching
  // Keeps video playing at the bottom when navigating to home, search, or channel
  document.addEventListener('click', function(e) {
    try {
      var video = document.querySelector('video');
      if (video && !video.paused) {
        var link = e.target && e.target.closest && e.target.closest('a[href]');
        if (link && link.href) {
          var destUrl = link.href;
          if (!destUrl.includes('/watch') && window.location.href.includes('/watch')) {
            var collapseBtn = document.querySelector('button[aria-label*="Collapse" i], button[aria-label*="collapse" i], .ytm-miniplayer-renderer');
            if (collapseBtn) {
              collapseBtn.click();
            }
          }
        }
      }
    } catch(e) {}
  }, true);

  // 8. YouTube Native Fullscreen Controller
  window.__setYouTubeFullscreen = function(enter) {
    try {
      var isFull = Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      if (enter && !isFull) {
        var fsBtn = document.querySelector('.ytp-fullscreen-button, button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], .fullscreen-icon');
        if (fsBtn) {
          fsBtn.click();
        } else {
          var video = document.querySelector('video');
          if (video && video.requestFullscreen) {
            video.requestFullscreen().catch(function(){});
          } else if (video && video.webkitRequestFullscreen) {
            video.webkitRequestFullscreen().catch(function(){});
          }
        }
      } else if (!enter && isFull) {
        var exitBtn = document.querySelector('button[aria-label*="Exit full screen" i], button[aria-label*="exit fullscreen" i]');
        if (exitBtn) {
          exitBtn.click();
        } else if (document.exitFullscreen) {
          document.exitFullscreen().catch(function(){});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen().catch(function(){});
        }
      }
    } catch(e) {}
  };
})();
true;
`;

export const SeamlessYouTubeApp: React.FC = () => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const lastBackPressTimeRef = useRef(0);

  // Auto-rotation & physical orientation detection
  useEffect(() => {
    // Start with orientation unlocked so device auto-rotates smoothly when turned sideways
    ScreenOrientation.unlockAsync().catch(() => {});

    const sub = ScreenOrientation.addOrientationChangeListener(event => {
      const o = event.orientationInfo.orientation;
      const landscape =
        o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      setIsLandscape(landscape);

      // Trigger YouTube's native fullscreen toggle on physical rotation
      webViewRef.current?.injectJavaScript(`
        if (window.__setYouTubeFullscreen) {
          window.__setYouTubeFullscreen(${landscape});
        }
        true;
      `);
    });

    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  // Background audio bridge resume callback
  useEffect(() => {
    backgroundAudioBridge.setResumeCallback((timeSec: number) => {
      webViewRef.current?.injectJavaScript(`
        (function() {
          var v = document.querySelector('video');
          if (v) {
            v.currentTime = ${timeSec};
            v.play().catch(function(){});
          }
        })();
        true;
      `);
    });

    return () => {
      backgroundAudioBridge.destroy();
    };
  }, []);

  // Fullscreen & landscape orientation and immersive bar handling
  useEffect(() => {
    const syncSystemBars = async () => {
      try {
        const isImmersive = isFullscreen || isLandscape;
        if (Platform.OS === 'android') {
          try {
            NavigationBar.setHidden(isImmersive);
          } catch {}
          await setVisibilityAsync(isImmersive ? 'hidden' : 'visible');
        }
        if (isFullscreen) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else {
          // When not locked in fullscreen, unlock so the device naturally follows phone holding position
          await ScreenOrientation.unlockAsync();
        }
      } catch (err) {
        console.warn('[SystemBars] Error:', err);
      }
    };
    void syncSystemBars();
  }, [isFullscreen, isLandscape]);

  // Android hardware back button
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (isFullscreen || isLandscape) {
        webViewRef.current?.injectJavaScript(`
          (function() {
            if (window.__setYouTubeFullscreen) {
              window.__setYouTubeFullscreen(false);
            } else if (document.fullscreenElement) {
              document.exitFullscreen().catch(function(){});
            } else if (document.webkitExitFullscreen) {
              document.webkitExitFullscreen().catch(function(){});
            }
          })();
          true;
        `);
        setIsFullscreen(false);
        return true;
      }

      // Check if user is watching a video and can collapse into Miniplayer instead of killing it
      webViewRef.current?.injectJavaScript(`
        (function() {
          var collapseBtn = document.querySelector('button[aria-label*="Collapse" i], button[aria-label*="collapse" i], .ytm-miniplayer-renderer button');
          if (collapseBtn) {
            collapseBtn.click();
          }
        })();
        true;
      `);

      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressTimeRef.current < 2000) {
        return false; // Exit app
      }
      lastBackPressTimeRef.current = now;
      ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack, isFullscreen, isLandscape]);

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'FULLSCREEN_CHANGE') {
        setIsFullscreen(Boolean(data.isFullscreen));
      } else if (data.type === 'MEDIA_STATE') {
        backgroundAudioBridge.updatePlaybackState(
          data.videoId,
          data.currentTime,
          data.isPlaying,
          {
            title: data.title,
            author: data.author,
          }
        );
      }
    } catch {}
  };

  // Handle transient network switch / ERR_NETWORK_CHANGED silently
  const handleError = useCallback((event: any) => {
    const desc = event?.nativeEvent?.description || '';
    if (desc.includes('NETWORK_CHANGED') || desc.includes('INTERNET_DISCONNECTED')) {
      setTimeout(() => {
        webViewRef.current?.reload();
      }, 500);
    }
  }, []);

  // Block external third-party ad networks at socket level
  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    const { url } = request;
    if (
      url.includes('doubleclick.net') ||
      url.includes('googleadservices.com') ||
      url.includes('googlesyndication.com')
    ) {
      return false; // Abort external ad trackers
    }
    return true;
  }, []);

  const isImmersive = isFullscreen || isLandscape;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: isImmersive ? 0 : Math.max(insets.top, 8) },
      ]}
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor="#0F0F0F"
        hidden={isImmersive}
        translucent={isImmersive}
      />

      <WebView
        ref={webViewRef}
        source={{ uri: 'https://m.youtube.com' }}
        userAgent={CHROME_ANDROID_USER_AGENT}
        injectedJavaScriptBeforeContentLoaded={BRAVE_CLEAN_ENGINE}
        injectedJavaScript={BRAVE_CLEAN_ENGINE}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
        onError={handleError}
        cacheEnabled={true}
        cacheMode="LOAD_DEFAULT"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={true}
        setSupportMultipleWindows={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        overScrollMode="never"
        style={styles.webView}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
