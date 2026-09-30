import React, { useRef, useImperativeHandle, forwardRef, memo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export interface YouTubeWebEngineRef {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  setQuality: (quality: string) => void;
  setPlaybackRate: (rate: number) => void;
}

interface YouTubeWebEngineProps {
  videoId: string;
  initialQuality?: string;
  isAudioOnly?: boolean;
  onReady?: (duration: number) => void;
  onTimeUpdate?: (currentTime: number, duration: number, bufferedSeconds: number) => void;
  onStateChange?: (isPlaying: boolean, isBuffering: boolean, isEnded: boolean) => void;
  onQualityChange?: (quality: string) => void;
  onError?: (error: any) => void;
}

// 3-Layer AdBlocker Engine (uBlock Origin / Brave / AdGuard architecture)
// Injected BEFORE content loads directly into the YouTube player context
const INJECTED_ADBLOCK_SCRIPT = `
(function() {
  if (window.__YT_ADBLOCK_INSTALLED__) return;
  window.__YT_ADBLOCK_INSTALLED__ = true;

  // 1. JSON.parse hook: Nullify adPlacements, adSlots, playerAds before YouTube parses player response
  try {
    var origParse = JSON.parse;
    JSON.parse = function() {
      var data = origParse.apply(this, arguments);
      try {
        if (data && typeof data === 'object') {
          if (data.adPlacements) data.adPlacements = [];
          if (data.adSlots) data.adSlots = [];
          if (data.playerAds) data.playerAds = [];
          delete data.adBreakHeartbeatParams;
          if (data.playerResponse) {
            if (data.playerResponse.adPlacements) data.playerResponse.adPlacements = [];
            if (data.playerResponse.adSlots) data.playerResponse.adSlots = [];
            if (data.playerResponse.playerAds) data.playerResponse.playerAds = [];
            delete data.playerResponse.adBreakHeartbeatParams;
          }
        }
      } catch(e) {}
      return data;
    };
  } catch(e) {}

  // 2. Window.fetch hook: Nullify ad tracking requests and strip adPlacements from /youtubei/v1/player
  try {
    var origFetch = window.fetch;
    window.fetch = async function() {
      var args = Array.prototype.slice.call(arguments);
      var url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
      if (url && (
        url.indexOf('/pagead/') !== -1 ||
        url.indexOf('/api/stats/ads') !== -1 ||
        url.indexOf('doubleclick') !== -1 ||
        url.indexOf('ptracking') !== -1 ||
        url.indexOf('googleads') !== -1 ||
        url.indexOf('/get_midroll_info') !== -1
      )) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      var response = await origFetch.apply(this, args);
      if (url && (url.indexOf('/youtubei/v1/player') !== -1 || url.indexOf('/get_video_info') !== -1)) {
        try {
          var clone = response.clone();
          var json = await clone.json();
          if (json.adPlacements) json.adPlacements = [];
          if (json.adSlots) json.adSlots = [];
          if (json.playerAds) json.playerAds = [];
          delete json.adBreakHeartbeatParams;
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch(e) {}
      }
      return response;
    };
  } catch(e) {}

  // 3. XMLHttpRequest hook: Redirect or neutralize ad tracking
  try {
    var origXHR = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      var rest = Array.prototype.slice.call(arguments, 2);
      if (typeof url === 'string' && (
        url.indexOf('/pagead/') !== -1 ||
        url.indexOf('/api/stats/ads') !== -1 ||
        url.indexOf('doubleclick') !== -1 ||
        url.indexOf('ptracking') !== -1 ||
        url.indexOf('googleads') !== -1 ||
        url.indexOf('/get_midroll_info') !== -1
      )) {
        url = 'about:blank';
      }
      return origXHR.apply(this, [method, url].concat(rest));
    };
  } catch(e) {}

  // 4. Inject Aggressive Zero-Ad & Clean Layout CSS
  try {
    var css = \`
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
      .ytp-chrome-top,
      .ytp-chrome-bottom,
      .ytp-watermark,
      .ytp-pause-overlay,
      .ytp-ce-element,
      .ytp-show-cards-title,
      .ytp-gradient-top,
      .ytp-gradient-bottom {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      html, body, #player, .html5-video-player, video {
        width: 100% !important;
        height: 100% !important;
        background: #000000 !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    \`;
    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  } catch(e) {}

  // Helper to post messages to React Native
  function postToNative(msg) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  // 5. Active Ad Destroyer: 30ms scanner + MutationObserver
  function destroyAds() {
    try {
      // 5a. Auto-click all modern & legacy skip buttons
      var skipSelectors = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        '.videoAdUiSkipButton',
        '.ytp-ad-skip-button-slot button',
        'button.ytp-ad-skip-button-modern',
        '[id^="skip-button"]',
        '.ytp-ad-skip-button-container button'
      ];
      for (var i = 0; i < skipSelectors.length; i++) {
        var btns = document.querySelectorAll(skipSelectors[i]);
        for (var j = 0; j < btns.length; j++) {
          btns[j].click();
        }
      }

      // 5b. If an ad video is detected, fast-forward to end & dispatch ended event
      var isAd = document.querySelector('.ad-showing, .ad-interrupting');
      var v = document.querySelector('video');
      if (isAd && v) {
        v.muted = true;
        v.playbackRate = 16.0;
        if (v.duration && !isNaN(v.duration)) {
          v.currentTime = v.duration - 0.05;
        } else {
          v.currentTime = 99999;
        }
        v.dispatchEvent(new Event('ended'));
      }
    } catch(e) {}
  }

  setInterval(destroyAds, 30);
  try {
    var obs = new MutationObserver(destroyAds);
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch(e) {}

  // 6. Real-time Time & State Bridge to Native (every 250ms)
  var lastTimeSent = -1;
  setInterval(function() {
    var p = document.getElementById('movie_player');
    var v = document.querySelector('video');
    if (p && typeof p.getCurrentTime === 'function') {
      var cur = p.getCurrentTime() || 0;
      var dur = p.getDuration() || (v ? v.duration : 0) || 0;
      var frac = p.getVideoLoadedFraction ? p.getVideoLoadedFraction() : 0;
      if (dur > 0 && Math.abs(cur - lastTimeSent) >= 0.25) {
        lastTimeSent = cur;
        postToNative({
          type: 'TIME_UPDATE',
          currentTime: cur,
          duration: dur,
          bufferedSeconds: frac * dur
        });
      }
    } else if (v && !isNaN(v.duration) && v.duration > 0) {
      var curV = v.currentTime || 0;
      if (Math.abs(curV - lastTimeSent) >= 0.25) {
        lastTimeSent = curV;
        postToNative({
          type: 'TIME_UPDATE',
          currentTime: curV,
          duration: v.duration || 0,
          bufferedSeconds: (v.buffered && v.buffered.length > 0) ? v.buffered.end(v.buffered.length - 1) : 0
        });
      }
    }
  }, 250);

  // 7. Ready Event Detector
  var isReadySent = false;
  function checkReady() {
    var p = document.getElementById('movie_player');
    var v = document.querySelector('video');
    if ((p && typeof p.getDuration === 'function' && p.getDuration() > 0) || (v && v.readyState >= 2)) {
      if (!isReadySent) {
        isReadySent = true;
        var dur = (p && p.getDuration) ? p.getDuration() : (v ? v.duration : 0);
        postToNative({
          type: 'READY',
          duration: dur,
          qualities: (p && p.getAvailableQualityLevels) ? p.getAvailableQualityLevels() : []
        });
      }
    }
  }
  setInterval(checkReady, 250);

  // Force auto-play as soon as video or movie_player is loaded
  var autoPlayAttempts = 0;
  var autoPlayInterval = setInterval(function() {
    autoPlayAttempts++;
    var p = document.getElementById('movie_player');
    var v = document.querySelector('video');
    try {
      if (p && p.playVideo) {
        p.playVideo();
      } else if (v) {
        v.play();
      }
    } catch(e) {}
    if ((p && p.getPlayerState && p.getPlayerState() === 1) || (v && !v.paused && v.currentTime > 0) || autoPlayAttempts > 25) {
      clearInterval(autoPlayInterval);
    }
  }, 200);

  // 8. Native Command Dispatcher
  window.handleNativeCommand = function(cmd) {
    var p = document.getElementById('movie_player');
    var v = document.querySelector('video');
    try {
      if (cmd.action === 'play') {
        if (p && p.playVideo) p.playVideo();
        else if (v) v.play();
      } else if (cmd.action === 'pause') {
        if (p && p.pauseVideo) p.pauseVideo();
        else if (v) v.pause();
      } else if (cmd.action === 'seek') {
        if (p && p.seekTo) p.seekTo(cmd.value, true);
        else if (v) v.currentTime = cmd.value;
      } else if (cmd.action === 'quality') {
        if (p) {
          if (p.setPlaybackQualityRange) p.setPlaybackQualityRange(cmd.value, cmd.value);
          if (p.setPlaybackQuality) p.setPlaybackQuality(cmd.value);
        }
      } else if (cmd.action === 'rate') {
        if (p && p.setPlaybackRate) p.setPlaybackRate(cmd.value);
        else if (v) v.playbackRate = cmd.value;
      }
    } catch(e) {}
  };
})();
true;
`;

export const YouTubeWebEngine = memo(
  forwardRef<YouTubeWebEngineRef, YouTubeWebEngineProps>((props, ref) => {
    const {
      videoId,
      initialQuality = 'hd1080',
      isAudioOnly = false,
      onReady,
      onTimeUpdate,
      onStateChange,
      onQualityChange,
      onError,
    } = props;

    const webViewRef = useRef<WebView>(null);
    const isReadyRef = useRef<boolean>(false);

    useImperativeHandle(ref, () => ({
      play: () => {
        executeCommand({ action: 'play' });
      },
      pause: () => {
        executeCommand({ action: 'pause' });
      },
      seekTo: (seconds: number) => {
        executeCommand({ action: 'seek', value: seconds });
      },
      setQuality: (quality: string) => {
        let ytQuality = 'hd1080';
        if (quality.includes('2160') || quality.includes('4K')) {
          ytQuality = 'highres';
        } else if (quality.includes('1440')) {
          ytQuality = 'hd1440';
        } else if (quality.includes('1080')) {
          ytQuality = 'hd1080';
        } else if (quality.includes('720')) {
          ytQuality = 'hd720';
        } else if (quality.includes('480')) {
          ytQuality = 'large';
        } else if (quality.includes('360')) {
          ytQuality = 'medium';
        } else if (quality.includes('240') || quality.includes('144')) {
          ytQuality = 'small';
        }
        executeCommand({ action: 'quality', value: ytQuality, rawLabel: quality });
      },
      setPlaybackRate: (rate: number) => {
        executeCommand({ action: 'rate', value: rate });
      },
    }));

    const executeCommand = (cmd: { action: string; value?: any; rawLabel?: string }) => {
      const js = `
        if (window.handleNativeCommand) {
          window.handleNativeCommand(${JSON.stringify(cmd)});
        }
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
    };

    const handleMessage = (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'READY') {
          isReadyRef.current = true;
          onReady?.(data.duration || 0);
          if (initialQuality) {
            executeCommand({ action: 'quality', value: initialQuality });
          }
          // Immediate play trigger
          executeCommand({ action: 'play' });
        } else if (data.type === 'TIME_UPDATE') {
          onTimeUpdate?.(data.currentTime, data.duration, data.bufferedSeconds);
        } else if (data.type === 'STATE_CHANGE') {
          onStateChange?.(data.isPlaying, data.isBuffering, data.isEnded);
        } else if (data.type === 'QUALITY_CHANGE') {
          onQualityChange?.(data.quality);
        } else if (data.type === 'ERROR') {
          onError?.(data.error);
        }
      } catch {}
    };

    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=0&playsinline=1&enablejsapi=1&fs=0&rel=0&iv_load_policy=3&modestbranding=1&origin=https://www.youtube.com`;

    return (
      <View style={styles.container} pointerEvents={isAudioOnly ? 'none' : 'auto'}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{
            uri: embedUrl,
            headers: {
              Referer: 'https://www.youtube.com/',
              Origin: 'https://www.youtube.com',
            },
          }}
          injectedJavaScriptBeforeContentLoaded={INJECTED_ADBLOCK_SCRIPT}
          injectedJavaScript={INJECTED_ADBLOCK_SCRIPT}
          style={[styles.webView, isAudioOnly && styles.hiddenWebView]}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          thirdPartyCookiesEnabled={true}
          sharedCookiesEnabled={true}
          scrollEnabled={false}
          bounces={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36"
          onMessage={handleMessage}
          onError={syntheticEvent => {
            // Ignore benign cancelled or subresource errors so we never prematurely fall back to native
            const { description, code } = syntheticEvent.nativeEvent;
            if (code === -999 || description?.includes('cancelled')) return;
            onError?.(syntheticEvent.nativeEvent);
          }}
          androidLayerType={Platform.OS === 'android' ? 'hardware' : 'none'}
        />
      </View>
    );
  })
);

YouTubeWebEngine.displayName = 'YouTubeWebEngine';

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000000',
  },
  hiddenWebView: {
    opacity: 0,
    height: 1,
  },
});
