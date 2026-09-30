import AsyncStorage from '@react-native-async-storage/async-storage';

const PO_TOKEN_KEY = 'yt_po_token';
const VISITOR_DATA_KEY = 'yt_visitor_data';
const TOKEN_TIMESTAMP_KEY = 'yt_po_token_timestamp';

// Cache validity: 6 hours (YouTube PO tokens are typically valid for several hours)
const PO_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

let inMemoryPoToken: string | null = null;
let inMemoryVisitorData: string | null = null;
let inMemoryTimestamp: number = 0;

/**
 * Initializes and loads cached PO-Token on app launch
 */
export const initPoTokenStorage = async (): Promise<void> => {
  try {
    const [token, visitor, ts] = await Promise.all([
      AsyncStorage.getItem(PO_TOKEN_KEY),
      AsyncStorage.getItem(VISITOR_DATA_KEY),
      AsyncStorage.getItem(TOKEN_TIMESTAMP_KEY),
    ]);

    if (token) {
      const parsedTs = ts ? parseInt(ts, 10) : 0;
      const isFresh = Date.now() - parsedTs < PO_TOKEN_TTL_MS;
      if (isFresh) {
        inMemoryPoToken = token;
        inMemoryVisitorData = visitor || null;
        inMemoryTimestamp = parsedTs;
        console.log('[PoTokenStorage] Loaded fresh PO-Token from disk cache');
      } else {
        console.log('[PoTokenStorage] Cached PO-Token expired, requesting refresh');
      }
    }
  } catch (error) {
    console.warn('[PoTokenStorage] Failed to read token from cache:', error);
  }
};

/**
 * Persists freshly obtained PO-Token and visitor data
 */
export const setPoToken = async (poToken: string, visitorData?: string): Promise<void> => {
  if (!poToken || typeof poToken !== 'string') return;

  const now = Date.now();
  inMemoryPoToken = poToken;
  if (visitorData) inMemoryVisitorData = visitorData;
  inMemoryTimestamp = now;

  console.log('[PoTokenStorage] New PO-Token stored (length:', poToken.length, ')');

  try {
    const promises: Promise<any>[] = [
      AsyncStorage.setItem(PO_TOKEN_KEY, poToken),
      AsyncStorage.setItem(TOKEN_TIMESTAMP_KEY, String(now)),
    ];
    if (visitorData) {
      promises.push(AsyncStorage.setItem(VISITOR_DATA_KEY, visitorData));
    }
    await Promise.all(promises);
  } catch (error) {
    console.warn('[PoTokenStorage] Failed to persist PO-Token to disk:', error);
  }
};

/**
 * Returns current PO-Token if valid
 */
export const getPoToken = (): string | null => {
  if (!inMemoryPoToken) return null;
  const isFresh = Date.now() - inMemoryTimestamp < PO_TOKEN_TTL_MS;
  return isFresh ? inMemoryPoToken : null;
};

/**
 * Returns current visitorData if available
 */
export const getVisitorData = (): string | null => {
  return inMemoryVisitorData;
};

/**
 * Returns full PO-Token bundle for InnerTube player requests
 */
export const getPoTokenInfo = (): { poToken: string; visitorData?: string } | null => {
  const token = getPoToken();
  if (!token) return null;
  return {
    poToken: token,
    visitorData: inMemoryVisitorData || undefined,
  };
};
