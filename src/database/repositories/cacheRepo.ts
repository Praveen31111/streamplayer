import { getDb } from '../db';

export interface CacheMetadataItem {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  duration: number;
  cachedAt: number;
}

/**
 * Save video metadata into local cache
 */
export const setCachedMetadata = async (
  videoId: string,
  title: string,
  author: string,
  thumbnailUrl: string,
  duration: number
): Promise<void> => {
  if (!videoId) return;
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO CacheMetadata (videoId, title, author, thumbnailUrl, duration, cachedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [videoId, title || 'Video', author || '', thumbnailUrl || '', duration || 0, Date.now()]
    );
  } catch (error) {
    console.warn('[CacheRepo] setCachedMetadata error:', error);
  }
};

/**
 * Retrieve cached video metadata if present and not expired (default maxAge: 24h)
 */
export const getCachedMetadata = async (
  videoId: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000
): Promise<CacheMetadataItem | null> => {
  if (!videoId) return null;
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<CacheMetadataItem>(
      `SELECT * FROM CacheMetadata WHERE videoId = ?`,
      [videoId]
    );
    if (!row) return null;
    if (Date.now() - row.cachedAt > maxAgeMs) {
      return null;
    }
    return row;
  } catch (error) {
    console.warn('[CacheRepo] getCachedMetadata error:', error);
    return null;
  }
};

/**
 * Purge expired cache metadata older than given maxAgeMs
 */
export const purgeExpiredCache = async (
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<void> => {
  try {
    const db = await getDb();
    const threshold = Date.now() - maxAgeMs;
    await db.runAsync(`DELETE FROM CacheMetadata WHERE cachedAt < ?`, [threshold]);
  } catch (error) {
    console.warn('[CacheRepo] purgeExpiredCache error:', error);
  }
};
