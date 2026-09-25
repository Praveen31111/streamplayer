import { getDb } from '../db';

export interface BookmarkItem {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  savedAt: number;
}

/**
 * Save a video to bookmarks / favorites
 */
export const saveBookmark = async (
  videoId: string,
  title: string,
  author: string,
  thumbnailUrl: string
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO SavedBookmarks (videoId, title, author, thumbnailUrl, savedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [videoId, title, author, thumbnailUrl, Date.now()]
  );
};

/**
 * Check if a video is bookmarked
 */
export const isBookmarked = async (videoId: string): Promise<boolean> => {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM SavedBookmarks WHERE videoId = ?`,
    [videoId]
  );
  return (row?.count || 0) > 0;
};

/**
 * Get all saved bookmarks
 */
export const getBookmarks = async (): Promise<BookmarkItem[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<BookmarkItem>(
    `SELECT * FROM SavedBookmarks ORDER BY savedAt DESC`
  );
  return rows;
};

/**
 * Delete a single bookmark
 */
export const deleteBookmark = async (videoId: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync(`DELETE FROM SavedBookmarks WHERE videoId = ?`, [videoId]);
};
