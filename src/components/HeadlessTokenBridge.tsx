import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { setPoToken, getPoToken } from '../auth/poTokenStorage';

const HEADLESS_PO_TOKEN_SCRIPT = `
(function() {
  if (window.__PO_EXTRACTOR_INSTALLED__) return;
  window.__PO_EXTRACTOR_INSTALLED__ = true;

  function reportToken(poToken, visitorData) {
    if (!poToken) return;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'PO_TOKEN_OBTAINED',
          poToken: poToken,
          visitorData: visitorData || ''
        }));
      }
    } catch(e) {}
  }

  // 1. Hook window.fetch for /youtubei/v1/player and related requests
  try {
    var origFetch = window.fetch;
    window.fetch = async function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        var url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
        var opts = args[1];
        if (opts && opts.body && typeof opts.body === 'string') {
          var body = JSON.parse(opts.body);
          var poToken = body?.serviceIntegrityDimensions?.poToken;
          var visitorData = body?.context?.client?.visitorData;
          if (poToken) {
            reportToken(poToken, visitorData);
          }
        }
      } catch(e) {}
      return origFetch.apply(this, args);
    };
  } catch(e) {}

  // 2. Hook XMLHttpRequest for player requests
  try {
    var origOpen = window.XMLHttpRequest.prototype.open;
    var origSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      return origOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function(data) {
      try {
        if (typeof data === 'string' && data.indexOf('poToken') !== -1) {
          var parsed = JSON.parse(data);
          var po = parsed?.serviceIntegrityDimensions?.poToken;
          var vd = parsed?.context?.client?.visitorData;
          if (po) {
            reportToken(po, vd);
          }
        }
      } catch(e) {}
      return origSend.apply(this, arguments);
    };
  } catch(e) {}

  // 3. Periodic Scanner of window.ytcfg
  var attempts = 0;
  var interval = setInterval(function() {
    attempts++;
    try {
      if (window.ytcfg && window.ytcfg.get) {
        var ctx = window.ytcfg.get('INNERTUBE_CONTEXT');
        var po = ctx?.serviceIntegrityDimensions?.poToken;
        var vd = window.ytcfg.get('VISITOR_DATA') || ctx?.client?.visitorData;
        if (po) {
          reportToken(po, vd);
          clearInterval(interval);
          return;
        }
      }
    } catch(e) {}
    if (attempts > 30) clearInterval(interval);
  }, 1000);
})();
true;
`;

export const HeadlessTokenBridge: React.FC = () => {
  const webViewRef = useRef<WebView>(null);
  const [needsToken, setNeedsToken] = useState<boolean>(() => !getPoToken());

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'PO_TOKEN_OBTAINED' && data.poToken) {
        console.log('[HeadlessTokenBridge] PO-Token successfully captured from BotGuard');
        void setPoToken(data.poToken, data.visitorData);
        setNeedsToken(false);
      }
    } catch {
      // Ignore parse errors
    }
  };

  if (!needsToken) {
    return null;
  }

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{
          uri: 'https://www.youtube.com/embed/fJ9rUzIMcZQ?autoplay=0&controls=0&mute=1&playsinline=1',
        }}
        injectedJavaScriptBeforeContentLoaded={HEADLESS_PO_TOKEN_SCRIPT}
        injectedJavaScript={HEADLESS_PO_TOKEN_SCRIPT}
        style={styles.hiddenWebView}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scrollEnabled={false}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        onMessage={handleMessage}
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  hiddenContainer: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    left: -100,
    top: -100,
    overflow: 'hidden',
  },
  hiddenWebView: {
    width: 1,
    height: 1,
  },
});
