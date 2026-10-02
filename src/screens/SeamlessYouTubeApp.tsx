import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  BackHandler,
  Platform,
  StatusBar,
  ToastAndroid,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setVisibilityAsync } from 'expo-navigation-bar';
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

        /* Fit Screen (Zoom to Fill) Engine - True Edge-to-Edge Past Front Camera Notch */
        html.fit-screen-active,
        body.fit-screen-active {
          padding-left: 0 !important;
          padding-right: 0 !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }

        html.fit-screen-active video,
        body.fit-screen-active video,
        video.fit-screen-cover {
          object-fit: cover !important;
          width: 100vw !important;
          height: 100vh !important;
          max-width: 100vw !important;
          max-height: 100vh !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          transform: none !important;
          z-index: 1 !important;
        }

        /* Inline Fit Screen Button in YouTube's Control Bars (Top & Bottom) */
        .yt-fit-screen-inline-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 40px !important;
          height: 40px !important;
          background: transparent !important;
          border: none !important;
          outline: none !important;
          cursor: pointer !important;
          padding: 0 !important;
          margin: 0 4px !important;
          vertical-align: middle !important;
          pointer-events: auto !important;
          z-index: 999999 !important;
          transition: transform 0.15s ease, opacity 0.2s ease !important;
        }

        .yt-fit-screen-inline-btn:active {
          transform: scale(0.85) !important;
        }

        .yt-fit-screen-inline-btn svg {
          display: block !important;
          width: 22px !important;
          height: 22px !important;
        }

        /* Floating Corner Button (handled via native React Native overlay) */
        #__yt_fit_screen_btn__ {
          display: none !important;
        }

        #__yt_fit_toast__ {
          position: absolute;
          top: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 15, 15, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #FFFFFF;
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 20px;
          z-index: 1000000 !important;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
          opacity: 0;
          transition: opacity 0.25s ease, transform 0.25s ease;
        }

        #__yt_fit_toast__.show {
          opacity: 1;
          transform: translateX(-50%) translateY(4px);
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

  function ensureViewportFitCover() {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        var content = meta.getAttribute('content') || '';
        if (!content.includes('viewport-fit=cover')) {
          meta.setAttribute('content', content + ', viewport-fit=cover');
        }
      } else {
        var newMeta = document.createElement('meta');
        newMeta.name = 'viewport';
        newMeta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
        document.head.appendChild(newMeta);
      }
    } catch(e) {}
  }

  // 3. Fallback Fast-Skip Watchdog
  function handleVideoAds() {
    try {
      injectStyles();
      ensureViewportFitCover();
      ensureFitScreenButton();

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
  window.__pendingFullscreen = false;

  function tryTriggerFullscreen(enter) {
    try {
      var isFull = Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      if (enter && !isFull) {
        var fsBtn = document.querySelector('button.fullscreen-icon, .fullscreen-icon, .ytp-fullscreen-button, button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], [aria-label*="पूरा स्क्रीन" i]');
        if (fsBtn) {
          fsBtn.click();
        } else {
          var overlay = document.querySelector('.player-control-overlay, #player-control-overlay, .html5-video-player');
          if (overlay) {
            overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
          var fsBtn2 = document.querySelector('button.fullscreen-icon, .fullscreen-icon, .ytp-fullscreen-button, button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], [aria-label*="पूरा स्क्रीन" i]');
          if (fsBtn2) {
            fsBtn2.click();
          } else {
            var video = document.querySelector('video');
            if (video) {
              if (video.requestFullscreen) {
                video.requestFullscreen().catch(function(){});
              } else if (video.webkitRequestFullscreen) {
                video.webkitRequestFullscreen().catch(function(){});
              }
            }
          }
        }
      } else if (!enter && isFull) {
        var exitBtn = document.querySelector('button[aria-label*="Exit full screen" i], button[aria-label*="exit fullscreen" i], [aria-label*="फ़ुल-स्क्रीन से बाहर" i]');
        if (exitBtn) {
          exitBtn.click();
        } else if (document.exitFullscreen) {
          document.exitFullscreen().catch(function(){});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen().catch(function(){});
        }
      }
    } catch(e) {}
  }

  window.__setYouTubeFullscreen = function(enter) {
    if (!window.location.href.includes('/watch') && !document.querySelector('video')) {
      return;
    }
    if (!enter && isFitCover) {
      isFitCover = false;
      applyFitScreenState(false);
      var btn = document.getElementById('__yt_fit_screen_btn__');
      if (btn) btn.innerHTML = FIT_ICON_EXPAND;
    }
    window.__pendingFullscreen = enter;
    tryTriggerFullscreen(enter);
  };

  // If browser required a user touch gesture to activate HTML5 fullscreen,
  // trigger on the first touch gesture while pending
  window.addEventListener('touchstart', function() {
    if (window.__pendingFullscreen) {
      window.__pendingFullscreen = false;
      tryTriggerFullscreen(true);
    }
  }, { capture: true, passive: true });

  window.addEventListener('click', function() {
    if (window.__pendingFullscreen) {
      window.__pendingFullscreen = false;
      tryTriggerFullscreen(true);
    }
  }, { capture: true, passive: true });

  // 9. Fit Screen (Zoom to Fill) Engine & Floating Toggle Button
  var isFitCover = false;
  var lastToggleTime = 0;
  var toastTimeout = null;

  var FIT_ICON_EXPAND = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#FFFFFF"><path d="M15 3l2.3 2.3-3.89 3.89 1.41 1.41L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 3.89 3.89 1.41-1.41L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 3.89-3.89-1.41-1.41L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-3.89-3.89-1.41 1.41 3.89 3.89L15 21h6v-6z"/></svg>';
  var FIT_ICON_COLLAPSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#3EA6FF"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z"/></svg>';

  function showFitToast(msg) {
    try {
      var toast = document.getElementById('__yt_fit_toast__');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = '__yt_fit_toast__';
        var container = document.querySelector('.html5-video-player') || document.body;
        container.appendChild(toast);
      }
      toast.textContent = msg;
      toast.classList.add('show');
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(function() {
        if (toast) toast.classList.remove('show');
      }, 1800);
    } catch(e) {}
  }

  function applyFitScreenState(active) {
    try {
      if (active) {
        document.documentElement.classList.add('fit-screen-active');
        document.body.classList.add('fit-screen-active');
      } else {
        document.documentElement.classList.remove('fit-screen-active');
        document.body.classList.remove('fit-screen-active');
      }

      var video = document.querySelector('video');
      if (video) {
        if (active) {
          video.classList.add('fit-screen-cover');
          video.style.setProperty('object-fit', 'cover', 'important');
        } else {
          video.classList.remove('fit-screen-cover');
          video.style.setProperty('object-fit', 'contain', 'important');
        }
      }
    } catch(e) {}
  }

  function toggleFitScreen() {
    isFitCover = !isFitCover;

    // 1. Ensure true native fullscreen
    var isFull = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );

    if (!isFull) {
      var fsBtn = document.querySelector('button.fullscreen-icon, .fullscreen-icon, .ytp-fullscreen-button, button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], [aria-label*="पूरा स्क्रीन" i]');
      if (fsBtn) {
        fsBtn.click();
      } else {
        var v = document.querySelector('video');
        if (v) {
          if (v.requestFullscreen) v.requestFullscreen().catch(function(){});
          else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen().catch(function(){});
        }
      }
    }

    // 2. Apply Fit Screen styles
    applyFitScreenState(isFitCover);

    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'FIT_SCREEN_CHANGE',
          isFit: isFitCover
        }));
      }
    } catch(e) {}

    // 3. Update all buttons' icon
    var btns = document.querySelectorAll('.yt-fit-screen-toggle-btn');
    for (var b = 0; b < btns.length; b++) {
      btns[b].innerHTML = isFitCover ? FIT_ICON_COLLAPSE : FIT_ICON_EXPAND;
    }

    // 4. Show HUD toast
    showFitToast(isFitCover ? 'Fit to Screen (Zoom to Fill)' : 'Original (16:9 Fit)');
  }

  window.toggleFitScreen = toggleFitScreen;

  function handleFitScreenClick(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    var now = Date.now();
    if (now - lastToggleTime < 350) return;
    lastToggleTime = now;
    toggleFitScreen();
  }

  function createFitButton(id, extraClass) {
    var btn = document.createElement('button');
    btn.id = id;
    btn.className = 'yt-fit-screen-toggle-btn ' + (extraClass || '');
    btn.setAttribute('aria-label', 'Fit Screen');
    btn.setAttribute('title', 'Fit to Screen / Zoom to Fill');
    btn.innerHTML = isFitCover ? FIT_ICON_COLLAPSE : FIT_ICON_EXPAND;

    btn.addEventListener('click', handleFitScreenClick, true);
    btn.addEventListener('touchend', handleFitScreenClick, true);
    return btn;
  }

  function ensureFitScreenButton() {
    try {
      if (!window.location.href.includes('/watch') && !document.querySelector('video')) {
        return;
      }

      // Anchor 1: Inside YouTube's top controls bar (next to Settings [ ⚙ ] or [CC])
      var settingsBtn = document.querySelector('button[aria-label*="Settings" i], .ytp-settings-button, button.icon-button[aria-label*="Settings" i]');
      if (settingsBtn && settingsBtn.parentElement) {
        var existingTopBtn = document.getElementById('__yt_fit_screen_top_btn__');
        if (!existingTopBtn) {
          var topBtn = createFitButton('__yt_fit_screen_top_btn__', 'yt-fit-screen-inline-btn');
          settingsBtn.parentElement.insertBefore(topBtn, settingsBtn);
        } else if (existingTopBtn.parentElement !== settingsBtn.parentElement) {
          settingsBtn.parentElement.insertBefore(existingTopBtn, settingsBtn);
        }
      }

      // Anchor 2: Inside YouTube's bottom controls bar (next to inbuilt rotate/fullscreen button)
      var fsBtn = document.querySelector(
        'button.fullscreen-icon, .ytp-fullscreen-button, button[aria-label*="Exit full screen" i], button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], [aria-label*="पूरा स्क्रीन" i], [aria-label*="पूर्ण स्क्रीन" i]'
      );
      if (fsBtn && fsBtn.parentElement) {
        var existingBottomBtn = document.getElementById('__yt_fit_screen_bottom_btn__');
        if (!existingBottomBtn) {
          var bottomBtn = createFitButton('__yt_fit_screen_bottom_btn__', 'yt-fit-screen-inline-btn');
          fsBtn.parentElement.insertBefore(bottomBtn, fsBtn);
        } else if (existingBottomBtn.parentElement !== fsBtn.parentElement) {
          fsBtn.parentElement.insertBefore(existingBottomBtn, fsBtn);
        }
      }

      // Anchor 3: Floating button in player-control-overlay or active fullscreen container
      var overlayContainer = document.querySelector('.player-control-overlay, ytm-player-control-overlay') ||
                             document.fullscreenElement ||
                             document.webkitFullscreenElement ||
                             document.querySelector('.html5-video-player');
      if (overlayContainer) {
        var existingFloatingBtn = document.getElementById('__yt_fit_screen_btn__');
        if (!existingFloatingBtn) {
          var floatBtn = createFitButton('__yt_fit_screen_btn__', 'yt-fit-screen-floating-btn');
          overlayContainer.appendChild(floatBtn);
        } else if (existingFloatingBtn.parentElement !== overlayContainer) {
          overlayContainer.appendChild(existingFloatingBtn);
        }
      }
    } catch(e) {}
  }

  // Periodic and event-based injection ensuring button is always present next to rotate icon
  setInterval(ensureFitScreenButton, 500);
  window.addEventListener('fullscreenchange', ensureFitScreenButton, { passive: true });
  window.addEventListener('webkitfullscreenchange', ensureFitScreenButton, { passive: true });
  window.addEventListener('orientationchange', function() {
    setTimeout(ensureFitScreenButton, 350);
  }, { passive: true });

  // 10. Hardware-Accelerated 2-Finger Pinch-to-Zoom Engine (MX Player Experience)
  (function initPersistentZoom() {
    var currentScale = 1.0;
    var baseScale = 1.0;
    var panX = 0;
    var panY = 0;
    var basePanX = 0;
    var basePanY = 0;
    var initialDistance = 0;
    var initialCenter = { x: 0, y: 0 };
    var isPinching = false;
    var badgeTimer = null;

    var zoomStyle = document.getElementById('ytm-persistent-zoom-style');
    if (!zoomStyle) {
      zoomStyle = document.createElement('style');
      zoomStyle.id = 'ytm-persistent-zoom-style';
      (document.head || document.documentElement).appendChild(zoomStyle);
    }

    function showZoomBadge(text) {
      try {
        var badge = document.getElementById('ytm-zoom-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'ytm-zoom-badge';
          badge.style.cssText = 'position:fixed;top:28px;left:50%;transform:translateX(-50%);background:rgba(15,15,15,0.92);color:#FFFFFF;padding:6px 18px;border-radius:20px;font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:2147483647;pointer-events:none;transition:opacity 0.2s ease;box-shadow:0 4px 16px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);letter-spacing:0.4px;';
          document.body.appendChild(badge);
        }
        badge.textContent = text;
        badge.style.opacity = '1';
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(function() {
          if (badge) badge.style.opacity = '0';
        }, 1200);
      } catch(e) {}
    }

    function applyZoom(scale, tx, ty, animate) {
      currentScale = Math.min(Math.max(scale, 1.0), 3.5);
      panX = currentScale <= 1.02 ? 0 : tx;
      panY = currentScale <= 1.02 ? 0 : ty;

      if (currentScale <= 1.02) {
        currentScale = 1.0;
        panX = 0;
        panY = 0;
        zoomStyle.textContent = '';
      } else {
        var transitionStr = animate ? 'transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1) !important;' : 'transition: none !important;';
        zoomStyle.textContent = \`
          video.video-stream, video.html5-main-video, video {
            transform: scale(\${currentScale.toFixed(3)}) translate(\${panX.toFixed(1)}px, \${panY.toFixed(1)}px) !important;
            transform-origin: center center !important;
            \${transitionStr}
          }
          .html5-video-player {
            overflow: hidden !important;
          }
        \`;
      }
    }

    function getTouchDist(t1, t2) {
      var dx = t1.clientX - t2.clientX;
      var dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(t1, t2) {
      return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      };
    }

    window.addEventListener('touchstart', function(e) {
      if (e.touches && e.touches.length === 2) {
        isPinching = true;
        initialDistance = getTouchDist(e.touches[0], e.touches[1]);
        initialCenter = getTouchCenter(e.touches[0], e.touches[1]);
        baseScale = currentScale;
        basePanX = panX;
        basePanY = panY;
      }
    }, { passive: true, capture: true });

    window.addEventListener('touchmove', function(e) {
      if (isPinching && e.touches && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        var dist = getTouchDist(e.touches[0], e.touches[1]);
        var center = getTouchCenter(e.touches[0], e.touches[1]);
        var factor = dist / (initialDistance || 1);
        var targetScale = Math.min(Math.max(baseScale * factor, 1.0), 3.5);

        var dx = (center.x - initialCenter.x) / targetScale;
        var dy = (center.y - initialCenter.y) / targetScale;
        applyZoom(targetScale, basePanX + dx, basePanY + dy, false);
      }
    }, { passive: false, capture: true });

    window.addEventListener('touchend', function(e) {
      if (isPinching && (!e.touches || e.touches.length < 2)) {
        isPinching = false;
        if (currentScale < 1.08) {
          applyZoom(1.0, 0, 0, true);
          showZoomBadge('Original');
        } else {
          applyZoom(currentScale, panX, panY, true);
          if (Math.abs(currentScale - 1.35) < 0.08) {
            showZoomBadge('Zoom to fill');
          } else {
            showZoomBadge(Math.round(currentScale * 100) + '%');
          }
        }
      }
    }, { passive: true, capture: true });

    window.addEventListener('touchcancel', function(e) {
      if (isPinching) {
        isPinching = false;
        applyZoom(currentScale, panX, panY, true);
      }
    }, { passive: true, capture: true });
  })();
})();
true;
`;

export const SeamlessYouTubeApp: React.FC = () => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isFitScreen, setIsFitScreen] = useState(false);
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
      if (!landscape) {
        setIsFitScreen(false);
      }

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
            await setVisibilityAsync(isImmersive ? 'hidden' : 'visible');
          } catch {}
        }
        if (isFullscreen && !isLandscape) {
          // If user tapped fullscreen button while holding phone vertically, lock landscape
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else if (!isFullscreen) {
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
      } else if (data.type === 'FIT_SCREEN_CHANGE') {
        setIsFitScreen(Boolean(data.isFit));
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
        translucent={true}
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

      {(isLandscape || isFullscreen) && (
        <View
          style={[
            styles.floatingFitOverlay,
            { right: Math.max(insets.right + 12, 16) },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.floatingFitBtn}
            onPress={() => {
              webViewRef.current?.injectJavaScript(`
                if (window.toggleFitScreen) {
                  window.toggleFitScreen();
                }
                true;
              `);
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Fit Screen Toggle"
          >
            <MaterialIcons
              name={isFitScreen ? 'fullscreen-exit' : 'fullscreen'}
              size={24}
              color={isFitScreen ? '#3EA6FF' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>
      )}
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
  floatingFitOverlay: {
    position: 'absolute',
    top: 52,
    zIndex: 999999,
  },
  floatingFitBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 15, 15, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
  },
});
