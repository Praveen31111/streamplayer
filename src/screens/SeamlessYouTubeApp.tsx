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

        /* Settings Gear Icon & Quality Menu - Instant 1-tap responsiveness */
        .ytm-custom-control.ytm-settings-button,
        button[aria-label*="Playback settings" i],
        button[aria-label*="Settings" i],
        .ytp-settings-button,
        button.fullscreen-icon,
        button[aria-label*="Full screen" i] {
          pointer-events: auto !important;
          z-index: 1000 !important;
        }

        ytm-menu-popup-renderer,
        ytm-bottom-sheet-renderer,
        .ytp-popup,
        .ytp-settings-menu {
          pointer-events: auto !important;
          z-index: 2147483647 !important;
        }

        /* Prevent playlist panel from sticking over watch page content in portrait */
        ytm-watch ytm-playlist-panel-renderer {
          position: relative !important;
        }

        /* Clean Edge-to-Edge Player in Landscape - Zero Black Walls */
        @media (orientation: landscape) {
          ytm-mobile-topbar-renderer,
          .mobile-topbar-header,
          ytm-playlist-panel-renderer,
          ytm-engagement-panel-section-list-renderer,
          .playlist-panel,
          ytm-pivot-bar-renderer {
            display: none !important;
            height: 0 !important;
            opacity: 0 !important;
            visibility: hidden !important;
          }

          ytm-watch,
          ytm-watch .player-container,
          #player-container-id,
          .player-container {
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
          }

          .html5-video-player {
            width: 100% !important;
            height: 100% !important;
            position: relative !important;
            overflow: hidden !important;
            background: transparent !important;
          }

          video.video-stream,
          video.html5-main-video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
            pointer-events: auto !important;
          }

          .player-control-overlay,
          .player-controls-background {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            pointer-events: auto !important;
            z-index: 20 !important;
          }
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

  // 6. Fullscreen Event Bridge & DOM Fullscreen Engine
  // Intercepts HTML5 fullscreen to keep player inside WebView DOM
  // Prevents Android's native onShowCustomView dialog from hiding WebView and windowboxing
  function notifyFullscreen(isFull) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'FULLSCREEN_CHANGE',
        isFullscreen: Boolean(isFull)
      }));
    }
  }

  try {
    if (Element.prototype.requestFullscreen) {
      Element.prototype.requestFullscreen = function() {
        notifyFullscreen(true);
        return Promise.resolve();
      };
    }
    if (Element.prototype.webkitRequestFullscreen) {
      Element.prototype.webkitRequestFullscreen = function() {
        notifyFullscreen(true);
      };
    }
    if (HTMLVideoElement.prototype.webkitEnterFullscreen) {
      HTMLVideoElement.prototype.webkitEnterFullscreen = function() {
        notifyFullscreen(true);
      };
    }
    if (document.exitFullscreen) {
      document.exitFullscreen = function() {
        notifyFullscreen(false);
        return Promise.resolve();
      };
    }
    if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen = function() {
        notifyFullscreen(false);
      };
    }
  } catch(e) {}

  document.addEventListener('fullscreenchange', function() {
    notifyFullscreen(Boolean(document.fullscreenElement));
  }, true);
  document.addEventListener('webkitfullscreenchange', function() {
    notifyFullscreen(Boolean(document.webkitFullscreenElement));
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
  var pendingLandscapeFullscreen = false;
  window.__setYouTubeFullscreen = function(enter) {
    try {
      var isFull = Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      if (enter && !isFull) {
        pendingLandscapeFullscreen = true;
        var fsBtn = document.querySelector('button.fullscreen-icon, button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], .ytp-fullscreen-button, .fullscreen-icon');
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
        pendingLandscapeFullscreen = false;
        var exitBtn = document.querySelector('button[aria-label*="Exit full screen" i], button[aria-label*="exit fullscreen" i], button.fullscreen-icon');
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

  // If user rotates phone sideways, the first touch gesture triggers fullscreen natively with user activation
  window.addEventListener('touchstart', function() {
    try {
      if (pendingLandscapeFullscreen) {
        pendingLandscapeFullscreen = false;
        var fsBtn = document.querySelector('button.fullscreen-icon, button[aria-label*="Full screen" i], button[aria-label*="fullscreen" i], .ytp-fullscreen-button, .fullscreen-icon');
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
      }
    } catch(e) {}
  }, { capture: true, passive: true });

  // 9. Hardware-Accelerated Persistent Pinch-to-Zoom Engine (MX Player & YouTube Native App Experience)
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
    var lastSingleTap = 0;
    var badgeTimer = null;

    // Dedicated style element with !important - Immune to YouTube script overwrites
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
          badge.style.opacity = '0';
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
          video, video.video-stream, video.html5-main-video {
            transform: scale(\${currentScale.toFixed(3)}) translate(\${panX.toFixed(1)}px, \${panY.toFixed(1)}px) !important;
            transform-origin: center center !important;
            object-fit: cover !important;
            \${transitionStr}
          }
          .html5-video-player {
            overflow: hidden !important;
          }
        \`;
      }
    }

    function getDist(t1, t2) {
      var dx = t1.clientX - t2.clientX;
      var dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getCenter(t1, t2) {
      return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      };
    }

    window.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        // Two fingers: Start Pinch & Pan
        isPinching = true;
        initialDistance = getDist(e.touches[0], e.touches[1]);
        initialCenter = getCenter(e.touches[0], e.touches[1]);
        baseScale = currentScale;
        basePanX = panX;
        basePanY = panY;
        e.preventDefault(); // Stop native WebView page zooming
      } else if (e.touches.length === 1 && !isPinching) {
        // One finger: Check for double-tap outside buttons
        var target = e.target;
        var isPlayerArea = target && (target.closest('#player-control-overlay') || target.closest('.html5-video-player') || target.tagName === 'VIDEO');
        var isButton = target && target.closest('button, a, [role="button"], input, select');

        var now = Date.now();
        if (isPlayerArea && !isButton && (now - lastSingleTap < 300)) {
          // Double-tap: Toggle between Original and Zoom to fill
          if (currentScale > 1.05) {
            applyZoom(1.0, 0, 0, true);
            showZoomBadge('Original');
          } else {
            applyZoom(1.35, 0, 0, true);
            showZoomBadge('Zoom to fill');
          }
          lastSingleTap = 0;
        } else {
          lastSingleTap = now;
        }
      }
    }

    function handleTouchMove(e) {
      if (!isPinching || e.touches.length !== 2) return;
      e.preventDefault();
      var dist = getDist(e.touches[0], e.touches[1]);
      var center = getCenter(e.touches[0], e.touches[1]);
      if (initialDistance > 0) {
        var scaleRatio = dist / initialDistance;
        var targetScale = baseScale * scaleRatio;
        var dx = (center.x - initialCenter.x) / targetScale;
        var dy = (center.y - initialCenter.y) / targetScale;
        applyZoom(targetScale, basePanX + dx, basePanY + dy, false);
      }
    }

    function handleTouchEnd(e) {
      if (isPinching && e.touches.length < 2) {
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
    }

    function handleTouchCancel() {
      if (isPinching) {
        isPinching = false;
        applyZoom(currentScale, panX, panY, true);
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });
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
            await setVisibilityAsync(isImmersive ? 'hidden' : 'visible');
          } catch {}
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
        allowsFullscreenVideo={false}
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
