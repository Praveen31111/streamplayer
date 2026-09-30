import { getDb } from '../db';

export interface HistoryItem {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  lastPositionMillis: number;
  totalDurationMillis: number;
  updatedAt: number;
}

/**
 * Save or update video watch progress in local history
 */
export const saveWatchProgress = async (
  videoId: string,
  title: string,
  author: string,
  thumbnailUrl: string,
  positionMillis: number,
  durationMillis: number
): Promise<void> => {
  if (!videoId) return;
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO WatchHistory 
       (videoId, title, author, thumbnailUrl, lastPositionMillis, totalDurationMillis, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        videoId,
        title || 'Video',
        author || '',
        thumbnailUrl || '',
        positionMillis || 0,
        durationMillis || 0,
        Date.now(),
      ]
    );
  } catch (error) {
    console.warn('[HistoryRepo] saveWatchProgress error:', error);
  }
};

/**
 * Get recent watch history items ordered by latest watched
 */
export const getWatchHistory = async (limit: number = 50): Promise<HistoryItem[]> => {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<HistoryItem>(
      `SELECT * FROM WatchHistory ORDER BY updatedAt DESC LIMIT ?`,
      [limit]
    );
    return rows || [];
  } catch (error) {
    console.warn('[HistoryRepo] getWatchHistory error:', error);
    return [];
  }
};

/**
 * Delete a single video from watch history
 */
export const deleteHistoryItem = async (videoId: string): Promise<void> => {
  if (!videoId) return;
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM WatchHistory WHERE videoId = ?`, [videoId]);
  } catch (error) {
    console.warn('[HistoryRepo] deleteHistoryItem error:', error);
  }
};

/**
 * Clear all watch history records
 */
export const clearWatchHistory = async (): Promise<void> => {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM WatchHistory`);
  } catch (error) {
    console.warn('[HistoryRepo] clearWatchHistory error:', error);
  }
};
