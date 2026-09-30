import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ClientProfile {
  id: string;
  name: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  clientNameHeader: string;
  osName?: string;
  osVersion?: string;
  hl?: string;
  gl?: string;
}

export interface DynamicApiConfig {
  version: string;
  lastUpdated: number;
  activeClientIndex: number;
  clientProfiles: ClientProfile[];
  pipedInstances: string[];
  invidiousInstances: string[];
  enableSponsorBlock: boolean;
  defaultAudioMode: boolean;
  autoFailover: boolean;
  remoteEndpoints: string[];
}

// 1. Curated, high-availability client profiles (SmartTube / Yuliskov / NewPipe architecture)
const DEFAULT_CLIENT_PROFILES: ClientProfile[] = [
  {
    id: 'android-main',
    name: 'Android Official Mobile',
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    clientNameHeader: '3',
    osName: 'Android',
    osVersion: '11',
    hl: 'en',
    gl: 'IN',
  },
  {
    id: 'android-vr',
    name: 'Android VR / Quest Client',
    clientName: 'ANDROID_VR',
    clientVersion: '1.61.48',
    userAgent:
      'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.0 Safari/537.36',
    clientNameHeader: '28',
    osName: 'Android',
    osVersion: '12',
    hl: 'en',
    gl: 'IN',
  },
  {
    id: 'tv-embedded',
    name: 'SmartTV Simply Embedded',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    userAgent:
      'Mozilla/5.0 (PlayStation; PlayStation 4/11.02) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.0 Safari/605.1.15',
    clientNameHeader: '85',
    hl: 'en',
    gl: 'IN',
  },
  {
    id: 'web-desktop',
    name: 'Web Desktop Client',
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    clientNameHeader: '1',
    hl: 'en',
    gl: 'IN',
  },
];

// 2. High-uptime, CORS-friendly Piped API mirrors
const DEFAULT_PIPED_INSTANCES: string[] = [
  'https://pa.il.ax',
  'https://piped.video',
  'https://api.piped.privacy.com.de',
  'https://pipedapi.kavin.rocks',
  'https://piped-api.lunar.icu',
];

// 3. High-uptime Invidious mirrors
const DEFAULT_INVIDIOUS_INSTANCES: string[] = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://vid.puffyan.us',
];

// 4. Default remote configuration endpoints (GitHub Raw / CDN failovers)
const DEFAULT_REMOTE_ENDPOINTS: string[] = [
  'https://raw.githubusercontent.com/Praveen31111/streamplayer/main/api-config.json',
  'https://cdn.jsdelivr.net/gh/Praveen31111/streamplayer@main/api-config.json',
];

const DEFAULT_CONFIG: DynamicApiConfig = {
  version: '1.2.0',
  lastUpdated: Date.now(),
  activeClientIndex: 0,
  clientProfiles: DEFAULT_CLIENT_PROFILES,
  pipedInstances: DEFAULT_PIPED_INSTANCES,
  invidiousInstances: DEFAULT_INVIDIOUS_INSTANCES,
  enableSponsorBlock: true,
  defaultAudioMode: true,
  autoFailover: true,
  remoteEndpoints: DEFAULT_REMOTE_ENDPOINTS,
};

const STORAGE_KEY = '@streamplayer_dynamic_api_config';
let currentConfig: DynamicApiConfig = { ...DEFAULT_CONFIG };
let isSyncing = false;
const instanceFailureMap = new Map<string, number>();

/**
 * Initialize Dynamic API Engine: Loads cached config from storage and syncs with remote in background
 */
export const initDynamicApiEngine = async (): Promise<DynamicApiConfig> => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: DynamicApiConfig = JSON.parse(saved);
      if (parsed && parsed.clientProfiles && parsed.clientProfiles.length > 0) {
        const isUpToDate = parsed.version === DEFAULT_CONFIG.version;
        currentConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          version: DEFAULT_CONFIG.version,
          clientProfiles: isUpToDate ? parsed.clientProfiles : DEFAULT_CLIENT_PROFILES,
          activeClientIndex: isUpToDate ? parsed.activeClientIndex : 0,
          // Ensure default fallbacks are never lost
          pipedInstances: Array.from(new Set([...parsed.pipedInstances, ...DEFAULT_PIPED_INSTANCES])),
          invidiousInstances: Array.from(
            new Set([...parsed.invidiousInstances, ...DEFAULT_INVIDIOUS_INSTANCES])
          ),
        };
      }
    }
  } catch (err) {
    console.warn('[DynamicApiEngine] Error loading saved config:', err);
  }

  // Trigger non-blocking background sync from remote endpoints
  syncRemoteConfigInBackground();

  return currentConfig;
};

/**
 * Non-blocking remote config sync across multiple fallback endpoints
 */
export const syncRemoteConfigInBackground = async (): Promise<void> => {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const endpoints = currentConfig.remoteEndpoints || DEFAULT_REMOTE_ENDPOINTS;

    for (const url of endpoints) {
      try {
        const res = await axios.get<Partial<DynamicApiConfig>>(url, {
          timeout: 4500,
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        });

        if (res.data && res.data.version) {
          const remoteData = res.data;
          // If remote version is newer or has updated profiles/instances, merge seamlessly
          const merged: DynamicApiConfig = {
            ...currentConfig,
            ...remoteData,
            clientProfiles:
              remoteData.clientProfiles && remoteData.clientProfiles.length > 0
                ? remoteData.clientProfiles
                : currentConfig.clientProfiles,
            pipedInstances:
              remoteData.pipedInstances && remoteData.pipedInstances.length > 0
                ? Array.from(new Set([...remoteData.pipedInstances, ...DEFAULT_PIPED_INSTANCES]))
                : currentConfig.pipedInstances,
            invidiousInstances:
              remoteData.invidiousInstances && remoteData.invidiousInstances.length > 0
                ? Array.from(new Set([...remoteData.invidiousInstances, ...DEFAULT_INVIDIOUS_INSTANCES]))
                : currentConfig.invidiousInstances,
            lastUpdated: Date.now(),
          };

          currentConfig = merged;
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          break; // Successfully synced from highest-priority live mirror
        }
      } catch {
        // Try next fallback endpoint
      }
    }
  } catch (err) {
    console.warn('[DynamicApiEngine] Background sync warning:', err);
  } finally {
    isSyncing = false;
  }
};

/**
 * Returns currently active InnerTube client profile
 */
export const getActiveClientProfile = (): ClientProfile => {
  const profiles = currentConfig.clientProfiles || DEFAULT_CLIENT_PROFILES;
  const idx = Math.min(Math.max(0, currentConfig.activeClientIndex || 0), profiles.length - 1);
  return profiles[idx] || DEFAULT_CLIENT_PROFILES[0];
};

/**
 * Generates dynamic HTTP headers for the active client profile
 */
export const getActiveClientHeaders = (): Record<string, string> => {
  const profile = getActiveClientProfile();
  return {
    'Content-Type': 'application/json',
    'User-Agent': profile.userAgent,
    'X-YouTube-Client-Name': profile.clientNameHeader,
    'X-YouTube-Client-Version': profile.clientVersion,
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
  };
};

/**
 * Auto-Failover: Automatically rotates to next working client profile if current one is challenged
 */
export const rotateToNextClientProfile = async (reason?: string): Promise<ClientProfile> => {
  const profiles = currentConfig.clientProfiles || DEFAULT_CLIENT_PROFILES;
  const nextIdx = (currentConfig.activeClientIndex + 1) % profiles.length;
  currentConfig.activeClientIndex = nextIdx;

  const newProfile = profiles[nextIdx];
  console.log(
    `[DynamicApiEngine] Auto-failover triggered (${reason || 'Client error'}). Switched to: ${newProfile.name} (${newProfile.clientVersion})`
  );

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
  } catch {
    // Ignore storage write error
  }

  return newProfile;
};

/**
 * Returns healthy Piped instances sorted by responsiveness
 */
export const getHealthyPipedInstances = (): string[] => {
  const list = currentConfig.pipedInstances || DEFAULT_PIPED_INSTANCES;
  return [...list].sort((a, b) => {
    const failA = instanceFailureMap.get(a) || 0;
    const failB = instanceFailureMap.get(b) || 0;
    return failA - failB;
  });
};

/**
 * Returns healthy Invidious instances sorted by responsiveness
 */
export const getHealthyInvidiousInstances = (): string[] => {
  const list = currentConfig.invidiousInstances || DEFAULT_INVIDIOUS_INSTANCES;
  return [...list].sort((a, b) => {
    const failA = instanceFailureMap.get(a) || 0;
    const failB = instanceFailureMap.get(b) || 0;
    return failA - failB;
  });
};

/**
 * Record an instance failure so it gets deprioritized automatically
 */
export const recordInstanceFailure = (url: string): void => {
  const currentFails = instanceFailureMap.get(url) || 0;
  instanceFailureMap.set(url, currentFails + 1);
};

/**
 * Record instance success to restore priority
 */
export const recordInstanceSuccess = (url: string): void => {
  instanceFailureMap.delete(url);
};

/**
 * Backward compatibility with existing remoteConfig callers
 */
export const getRemoteConfig = async (): Promise<DynamicApiConfig> => {
  return currentConfig;
};
