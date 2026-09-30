import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import * as SplashScreen from 'expo-splash-screen';
import { RootErrorBoundary } from './src/components/RootErrorBoundary';
import { AppSplashScreen } from './src/components/AppSplashScreen';
import { SeamlessYouTubeApp } from './src/screens/SeamlessYouTubeApp';

// Keep native splash screen visible while app resources initialize
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [isAppReady, setIsAppReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // App engine initialization
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.warn('[AppInit] Init error:', err);
      } finally {
        // Hide native splash once React component tree is mounted
        await SplashScreen.hideAsync().catch(() => {});
        setIsAppReady(true);
      }
    };

    void initializeApp();

    // OTA (Over-The-Air) Auto-Update: Silently check & apply JS bundle updates
    const checkForOTAUpdate = async () => {
      try {
        if (!__DEV__) {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync();
          }
        }
      } catch (e) {
        console.log('[OTA] Update check skipped:', e);
      }
    };
    void checkForOTAUpdate();
  }, []);

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SeamlessYouTubeApp />
        {showSplash && (
          <AppSplashScreen
            isReady={isAppReady}
            onFinish={() => setShowSplash(false)}
          />
        )}
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
