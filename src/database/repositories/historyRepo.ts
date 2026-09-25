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
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO WatchHistory 
     (videoId, title, author, thumbnailUrl, lastPositionMillis, totalDurationMillis, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [videoId, title, author, thumbnailUrl, positionMillis, durationMillis, Date.now()]
  );
};

/**
 * Get recent watch history items ordered by latest watched
 */
export const getWatchHistory = async (limit: number = 50): Promise<HistoryItem[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<HistoryItem>(
    `SELECT * FROM WatchHistory ORDER BY updatedAt DESC LIMIT ?`,
    [limit]
  );
  return rows;
};

/**
 * Delete a single video from watch history
 */
export const deleteHistoryItem = async (videoId: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync(`DELETE FROM WatchHistory WHERE videoId = ?`, [videoId]);
};

/**
 * Clear all watch history records
 */
export const clearWatchHistory = async (): Promise<void> => {
  const db = await getDb();
  await db.runAsync(`DELETE FROM WatchHistory`);
};
