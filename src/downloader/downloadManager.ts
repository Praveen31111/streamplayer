import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../database/db';
import { extractInnerTubeStreamDirect } from '../api/mediaServiceCore';

export interface DownloadItem {
  videoId: string;
  title: string;
  quality: string;
  localUri: string;
  fileSizeBytes: number;
  status: 'downloading' | 'completed' | 'failed';
  progress: number;
  createdAt: number;
}

export const downloadVideoForOffline = async (
  videoId: string,
  title: string,
  streamUrl: string,
  onProgress?: (progressRatio: number) => void
): Promise<string> => {
  const db = await getDb();
  const fileUri = `${FileSystem.documentDirectory}${videoId}.mp4`;

  // 1. Resolve true progressive MP4 stream (cannot download local .mpd manifest file)
  let targetDownloadUrl = streamUrl;
  if (
    !targetDownloadUrl ||
    targetDownloadUrl.endsWith('.mpd') ||
    targetDownloadUrl.startsWith('file://')
  ) {
    const extracted = await extractInnerTubeStreamDirect(videoId);
    targetDownloadUrl = extracted?.downloadUrl || extracted?.streamUrl || '';
  }

  if (!targetDownloadUrl || targetDownloadUrl.endsWith('.mpd')) {
    throw new Error('No progressive MP4 stream available for offline download.');
  }

  // 2. Insert download record in SQLite
  await db.runAsync(
    `INSERT OR REPLACE INTO DownloadQueue 
     (videoId, title, quality, localUri, status, progress, createdAt)
     VALUES (?, ?, '720p', ?, 'downloading', 0.0, ?)`,
    [videoId, title, fileUri, Date.now()]
  );

  // 3. Start Resumable Download with Android YouTube headers
  const downloadResumable = FileSystem.createDownloadResumable(
    targetDownloadUrl,
    fileUri,
    {
      headers: {
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
      },
    },
    downloadProgress => {
      const progress =
        downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
      if (onProgress && !isNaN(progress) && isFinite(progress)) {
        onProgress(Math.min(1.0, Math.max(0.0, progress)));
      }
    }
  );

  try {
    const result = await downloadResumable.downloadAsync();
    if (result && result.uri) {
      const fileInfo = await FileSystem.getInfoAsync(result.uri);
      const sizeBytes = (fileInfo as any).size || 0;

      await db.runAsync(
        `UPDATE DownloadQueue SET status = 'completed', progress = 1.0, fileSizeBytes = ? WHERE videoId = ?`,
        [sizeBytes, videoId]
      );
      return result.uri;
    }
    throw new Error('Download failed without URI');
  } catch (error) {
    console.error('Download error:', error);
    await db.runAsync(`UPDATE DownloadQueue SET status = 'failed' WHERE videoId = ?`, [videoId]);
    throw error;
  }
};

export const getCompletedDownloads = async (): Promise<DownloadItem[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<DownloadItem>(
    `SELECT * FROM DownloadQueue WHERE status = 'completed' ORDER BY createdAt DESC`
  );
  return rows;
};

export const deleteDownloadedVideo = async (videoId: string, localUri: string) => {
  try {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    const db = await getDb();
    await db.runAsync(`DELETE FROM DownloadQueue WHERE videoId = ?`, [videoId]);
  } catch (error) {
    console.error('Error deleting offline video:', error);
  }
};
