import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Authentic Google Chrome Android User-Agent without 'wv' or 'Version/4.0'
// This bypasses Google's "403: disallowed_useragent" and allows seamless Gmail / Google Account login
const CHROME_ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36';

// 4-Layer Zero-Ad Engine: Injected BEFORE content loads
// 1. Hook JSON.parse & fetch to strip adPlacements & playerAds (ensures video starts instantly with zero ads)
// 2. Kill ad tracking requests (doubleclick, pagead, googleads)
// 3. Inject CSS to hide all sponsored cards, banners, and upsell popups
// 4. Fallback 30ms Watchdog + MutationObserver to auto-skip and 16x fast-forward any server-side ad
const INJECTED_ZERO_AD_SCRIPT = `
(function() {
  if (window.__ZERO_AD_INITIALIZED__) return;
  window.__ZERO_AD_INITIALIZED__ = true;

  // Helper: Deep strip ads from any YouTube player response
  function sanitizePlayerResponse(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      if (obj.adPlacements) obj.adPlacements = [];
      if (obj.adSlots) obj.adSlots = [];
      if (obj.playerAds) obj.playerAds = [];
      delete obj.adBreakHeartbeatParams;
      if (obj.playerResponse) {
        sanitizePlayerResponse(obj.playerResponse);
      }
    } catch(e) {}
    return obj;
  }

  // 1. Hook JSON.parse: Nullify ad arrays before YouTube's frontend scripts parse them
  try {
    var origParse = JSON.parse;
    JSON.parse = function() {
      var data = origParse.apply(this, arguments);
      return sanitizePlayerResponse(data);
    };
  } catch(e) {}

  // 2. Hook window.fetch: Strip ads from /youtubei/v1/player and block ad tracking endpoints
  try {
    var origFetch = window.fetch;
    window.fetch = async function() {
      var args = Array.prototype.slice.call(arguments);
      var url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';

      // Block tracking & ad telemetry calls
      if (url && (
        url.indexOf('/pagead/') !== -1 ||
        url.indexOf('/api/stats/ads') !== -1 ||
        url.indexOf('doubleclick.net') !== -1 ||
        url.indexOf('googleads') !== -1 ||
        url.indexOf('/ptracking') !== -1 ||
        url.indexOf('/get_midroll_info') !== -1
      )) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      var res = await origFetch.apply(this, args);

      // Clean player data from InnerTube API
      if (url && (url.indexOf('/youtubei/v1/player') !== -1 || url.indexOf('/get_video_info') !== -1)) {
        try {
          var clone = res.clone();
          var json = await clone.json();
          sanitizePlayerResponse(json);
          return new Response(JSON.stringify(json), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers
          });
        } catch(e) {}
      }

      return res;
    };
  } catch(e) {}

  // 3. Hook XMLHttpRequest: Nullify ad tracking calls
  try {
    var origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      var rest = Array.prototype.slice.call(arguments, 2);
      if (typeof url === 'string' && (
        url.indexOf('/pagead/') !== -1 ||
        url.indexOf('/api/stats/ads') !== -1 ||
        url.indexOf('doubleclick.net') !== -1 ||
        url.indexOf('googleads') !== -1 ||
        url.indexOf('/ptracking') !== -1 ||
        url.indexOf('/get_midroll_info') !== -1
      )) {
        url = 'about:blank';
      }
      return origOpen.apply(this, [method, url].concat(rest));
    };
  } catch(e) {}

  // 4. Inject Aggressive Zero-Ad & Dark Premium CSS
  function injectStyles() {
    try {
      if (document.getElementById('__zero_ad_styles__')) return;
      var style = document.createElement('style');
      style.id = '__zero_ad_styles__';
      style.textContent = \`
        /* Hide all Video Ad modules, banners & overlays */
        .video-ads,
        .ytp-ad-module,
        .ytp-ad-player-overlay,
        .ytp-ad-overlay-container,
        .ytp-ad-message-container,
        .ytp-ad-preview-container,
        .ytp-ad-text,
        .ytp-suggested-action,
        .ad-created,
        #player-ads,
        .annotation,
        .ytp-pause-overlay,
        ytm-promoted-sparkles-web-renderer,
        ytd-promoted-video-renderer,
        ytm-promoted-video-renderer,
        ytd-ad-slot-renderer,
        ytm-companion-ad-renderer,
        ytm-upsell-dialog-renderer,
        ytd-enforcement-message-view-model,
        .ad-container,
        .ad-div,
        [id*="ad-"] {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
          height: 0 !important;
        }

        /* Prevent anti-adblock dialog overlays from dimming or blocking the video */
        tp-yt-paper-dialog,
        yt-playability-error-supported-renderers {
          display: none !important;
        }

        /* Pure Dark YouTube aesthetic */
        body, html, ytm-app {
          background-color: #0F0F0F !important;
        }
      \`;
      (document.head || document.documentElement).appendChild(style);
    } catch(e) {}
  }

  // 5. Active Watchdog: Auto-skip any server-side unskippable ads at 16x speed
  function executeAdKiller() {
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
        'button[aria-label*="Skip"]'
      ];
      for (var i = 0; i < skipSelectors.length; i++) {
        var btns = document.querySelectorAll(skipSelectors[i]);
        for (var j = 0; j < btns.length; j++) {
          btns[j].click();
        }
      }

      // If an ad is actively playing, mute and fast-forward to the end instantly
      var isAdShowing = document.querySelector('.ad-showing, .ad-interrupting');
      var video = document.querySelector('video');
      if (isAdShowing && video) {
        video.muted = true;
        video.playbackRate = 16.0;
        if (video.duration && !isNaN(video.duration)) {
          video.currentTime = video.duration - 0.05;
        } else {
          video.currentTime = 99999;
        }
        video.dispatchEvent(new Event('ended'));
      }

      // Auto-dismiss any "Try YouTube Premium" or anti-adblock popups
      var dismissBtn = document.querySelector('button[aria-label="Dismiss"], ytm-button-renderer[dialog-dismiss]');
      if (dismissBtn) {
        dismissBtn.click();
      }
    } catch(e) {}
  }

  setInterval(executeAdKiller, 30);
  try {
    var observer = new MutationObserver(executeAdKiller);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch(e) {}
})();
true;
`;

export const YouTubeWebScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Handle Android hardware back button
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [canGoBack]);

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setIsLoading(navState.loading);
  };

  const handleHomePress = () => {
    webViewRef.current?.injectJavaScript(`window.location.href = 'https://m.youtube.com'; true;`);
  };

  const handleSignInPress = () => {
    // Direct Google Account login link tailored for YouTube
    const signInUrl = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://m.youtube.com/';
    webViewRef.current?.injectJavaScript(`window.location.href = '${signInUrl}'; true;`);
  };

  const handleRefresh = () => {
    webViewRef.current?.reload();
  };

  // Block third-party ad networks at WebView layer before HTTP connection is made
  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    const { url } = request;
    if (
      url.includes('doubleclick.net') ||
      url.includes('googleadservices.com') ||
      url.includes('googlesyndication.com') ||
      (url.includes('/pagead/') && !url.includes('youtube.com/watch'))
    ) {
      return false; // Abort ad network request
    }
    return true;
  }, []);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F0F" />

      {/* Top Header / Control Bar */}
      <View style={styles.header}>
        {/* Navigation Buttons */}
        <View style={styles.navGroup}>
          <TouchableOpacity
            style={[styles.iconButton, !canGoBack && styles.disabledButton]}
            onPress={() => webViewRef.current?.goBack()}
            disabled={!canGoBack}
          >
            <Ionicons name="chevron-back" size={22} color={canGoBack ? '#FFFFFF' : '#555555'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconButton, !canGoForward && styles.disabledButton]}
            onPress={() => webViewRef.current?.goForward()}
            disabled={!canGoForward}
          >
            <Ionicons name="chevron-forward" size={22} color={canGoForward ? '#FFFFFF' : '#555555'} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconButton} onPress={handleRefresh}>
            <Ionicons name="reload" size={18} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconButton} onPress={handleHomePress}>
            <Ionicons name="home" size={19} color="#FF0000" />
          </TouchableOpacity>
        </View>

        {/* Protection Shield Indicator */}
        <View style={styles.shieldBadge}>
          <Ionicons name="shield-checkmark" size={14} color="#00E676" />
          <Text style={styles.shieldText}>Zero-Ad Mode</Text>
        </View>

        {/* Google Sign In Button */}
        <TouchableOpacity style={styles.signInButton} onPress={handleSignInPress}>
          <Ionicons name="person-circle-outline" size={16} color="#FFFFFF" />
          <Text style={styles.signInText}>Sign In</Text>
        </TouchableOpacity>
      </View>

      {/* Loading Progress Bar */}
      {isLoading && (
        <View style={styles.loadingBarContainer}>
          <ActivityIndicator size="small" color="#FF0000" />
        </View>
      )}

      {/* High-Performance Ad-Free YouTube WebView */}
      <View style={styles.webContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://m.youtube.com' }}
          userAgent={CHROME_ANDROID_USER_AGENT}
          injectedJavaScriptBeforeContentLoaded={INJECTED_ZERO_AD_SCRIPT}
          injectedJavaScript={INJECTED_ZERO_AD_SCRIPT}
          onNavigationStateChange={handleNavigationStateChange}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          thirdPartyCookiesEnabled={true}
          sharedCookiesEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo={true}
          setSupportMultipleWindows={false}
          androidLayerType={Platform.OS === 'android' ? 'hardware' : 'none'}
          pullToRefreshEnabled={true}
          bounces={false}
          style={styles.webView}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#181818',
    borderBottomWidth: 1,
    borderBottomColor: '#282828',
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 6,
    marginRight: 4,
    borderRadius: 6,
  },
  disabledButton: {
    opacity: 0.4,
  },
  shieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
  },
  shieldText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  signInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#272727',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3D3D3D',
  },
  signInText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  loadingBarContainer: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    zIndex: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webContainer: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
});
