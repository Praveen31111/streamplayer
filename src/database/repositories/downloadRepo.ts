import { getDb } from '../db';

export interface DownloadRecord {
  videoId: string;
  title: string;
  quality: string;
  localUri: string;
  fileSizeBytes: number;
  status: 'downloading' | 'completed' | 'failed';
  progress: number;
  createdAt: number;
}

/**
 * Register a new download in the queue
 */
export const insertDownloadRecord = async (
  videoId: string,
  title: string,
  quality: string,
  localUri: string
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO DownloadQueue 
     (videoId, title, quality, localUri, fileSizeBytes, status, progress, createdAt)
     VALUES (?, ?, ?, ?, 0, 'downloading', 0.0, ?)`,
    [videoId, title, quality, localUri, Date.now()]
  );
};

/**
 * Update progress ratio for an ongoing download
 */
export const updateDownloadProgress = async (
  videoId: string,
  progress: number
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `UPDATE DownloadQueue SET progress = ? WHERE videoId = ? AND status = 'downloading'`,
    [progress, videoId]
  );
};

/**
 * Mark download as completed with final file size
 */
export const markDownloadCompleted = async (
  videoId: string,
  fileSizeBytes: number
): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `UPDATE DownloadQueue 
     SET status = 'completed', progress = 1.0, fileSizeBytes = ? 
     WHERE videoId = ?`,
    [fileSizeBytes, videoId]
  );
};

/**
 * Mark download as failed
 */
export const markDownloadFailed = async (videoId: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync(
    `UPDATE DownloadQueue SET status = 'failed' WHERE videoId = ?`,
    [videoId]
  );
};

/**
 * Fetch all completed downloads
 */
export const getCompletedDownloads = async (): Promise<DownloadRecord[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<DownloadRecord>(
    `SELECT * FROM DownloadQueue WHERE status = 'completed' ORDER BY createdAt DESC`
  );
  return rows;
};

/**
 * Fetch all downloads regardless of status
 */
export const getAllDownloads = async (): Promise<DownloadRecord[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<DownloadRecord>(
    `SELECT * FROM DownloadQueue ORDER BY createdAt DESC`
  );
  return rows;
};

/**
 * Remove a download record from the database
 */
export const deleteDownloadRecord = async (videoId: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync(`DELETE FROM DownloadQueue WHERE videoId = ?`, [videoId]);
};
