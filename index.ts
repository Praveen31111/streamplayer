import './src/api/polyfills';

// Global Crash Guard for Android Release Builds
// Catches unhandled JS exceptions before they reach native crash handlers
if (typeof (globalThis as any).ErrorUtils !== 'undefined') {
  const globalHandler = (globalThis as any).ErrorUtils.getGlobalHandler?.();
  (globalThis as any).ErrorUtils.setGlobalHandler((error: any, isFatal: boolean) => {
    console.warn('[CrashGuard] Intercepted error (isFatal:', isFatal, '):', error);
    if (__DEV__ && globalHandler) {
      globalHandler(error, isFatal);
    }
  });
}

// Global unhandled promise rejection guard
if (typeof (globalThis as any).addEventListener === 'function') {
  (globalThis as any).addEventListener('unhandledrejection', (event: any) => {
    console.warn('[CrashGuard] Unhandled rejection intercepted:', event?.reason);
    event?.preventDefault?.();
  });
}

import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
