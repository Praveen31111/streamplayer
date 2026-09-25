import { extractPlayableStream, PlayableStreamResult } from '../api/youtubeClient';

const streamMemoryCache = new Map<string, { data: PlayableStreamResult; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes memory TTL

/**
 * Pre-warm and cache video streams in the background
 */
export const prewarmVideoStream = async (videoId: string): Promise<void> => {
  if (!videoId) return;

  const existing = streamMemoryCache.get(videoId);
  if (existing && Date.now() - existing.cachedAt < CACHE_TTL_MS) {
    return;
  }

  try {
    const data = await extractPlayableStream(videoId);
    if (data && data.streamUrl) {
      streamMemoryCache.set(videoId, { data, cachedAt: Date.now() });
    }
  } catch {
    // Ignore background prewarm failure
  }
};

/**
 * Retrieve pre-warmed stream result if available
 */
export const getPrewarmedStream = (videoId: string): PlayableStreamResult | null => {
  const existing = streamMemoryCache.get(videoId);
  if (existing && Date.now() - existing.cachedAt < CACHE_TTL_MS) {
    return existing.data;
  }
  return null;
};
