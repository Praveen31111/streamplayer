import axios from 'axios';

export interface RemoteConfig {
  version: string;
  enableSponsorBlock: boolean;
  defaultAudioMode: boolean;
  invidiousFallbacks: string[];
  pipedFallbacks: string[];
  customUserAgent?: string;
}

const DEFAULT_CONFIG: RemoteConfig = {
  version: '1.0.0',
  enableSponsorBlock: true,
  defaultAudioMode: true,
  invidiousFallbacks: [
    'https://vid.puffyan.us',
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
  ],
  pipedFallbacks: [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.privacy.com.de',
  ],
};

let cachedConfig: RemoteConfig = DEFAULT_CONFIG;
let lastFetchedAt = 0;

/**
 * Fetch dynamic remote configuration (cached for 1 hour)
 */
export const getRemoteConfig = async (remoteGistUrl?: string): Promise<RemoteConfig> => {
  const ONE_HOUR = 60 * 60 * 1000;
  if (Date.now() - lastFetchedAt < ONE_HOUR && cachedConfig !== DEFAULT_CONFIG) {
    return cachedConfig;
  }

  if (!remoteGistUrl) {
    return cachedConfig;
  }

  try {
    const res = await axios.get<RemoteConfig>(remoteGistUrl, { timeout: 4000 });
    if (res.data && res.data.version) {
      cachedConfig = { ...DEFAULT_CONFIG, ...res.data };
      lastFetchedAt = Date.now();
    }
  } catch (err) {
    console.warn('Could not fetch remote config, using defaults:', err);
  }

  return cachedConfig;
};
