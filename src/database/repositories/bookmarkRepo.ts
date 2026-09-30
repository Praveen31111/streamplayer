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
  if (!videoId) return;
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO SavedBookmarks (videoId, title, author, thumbnailUrl, savedAt)
       VALUES (?, ?, ?, ?, ?)`,
      [videoId, title || 'Video', author || '', thumbnailUrl || '', Date.now()]
    );
  } catch (error) {
    console.warn('[BookmarkRepo] saveBookmark error:', error);
  }
};

/**
 * Check if a video is bookmarked
 */
export const isBookmarked = async (videoId: string): Promise<boolean> => {
  if (!videoId) return false;
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM SavedBookmarks WHERE videoId = ?`,
      [videoId]
    );
    return (row?.count || 0) > 0;
  } catch (error) {
    console.warn('[BookmarkRepo] isBookmarked error:', error);
    return false;
  }
};

/**
 * Get all saved bookmarks
 */
export const getBookmarks = async (): Promise<BookmarkItem[]> => {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<BookmarkItem>(
      `SELECT * FROM SavedBookmarks ORDER BY savedAt DESC`
    );
    return rows || [];
  } catch (error) {
    console.warn('[BookmarkRepo] getBookmarks error:', error);
    return [];
  }
};

/**
 * Delete a single bookmark
 */
export const deleteBookmark = async (videoId: string): Promise<void> => {
  if (!videoId) return;
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM SavedBookmarks WHERE videoId = ?`, [videoId]);
  } catch (error) {
    console.warn('[BookmarkRepo] deleteBookmark error:', error);
  }
};
