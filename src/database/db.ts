import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('custom_player.db');
    await initializeTables(dbInstance);
  }
  return dbInstance;
};

const initializeTables = async (db: SQLite.SQLiteDatabase) => {
  // 1. Cache Metadata
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS CacheMetadata (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnailUrl TEXT,
      duration INTEGER,
      cachedAt INTEGER NOT NULL
    );
  `);

  // 2. Watch History
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS WatchHistory (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnailUrl TEXT,
      lastPositionMillis INTEGER DEFAULT 0,
      totalDurationMillis INTEGER DEFAULT 0,
      updatedAt INTEGER NOT NULL
    );
  `);

  // 3. Offline Downloads
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS DownloadQueue (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      quality TEXT NOT NULL,
      localUri TEXT NOT NULL,
      fileSizeBytes INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('downloading', 'completed', 'failed')),
      progress REAL DEFAULT 0.0,
      createdAt INTEGER NOT NULL
    );
  `);

  // 4. Saved Bookmarks / Favorites
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS SavedBookmarks (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnailUrl TEXT,
      savedAt INTEGER NOT NULL
    );
  `);

  // 5. User Channel Subscriptions (Local & Cloud Sync)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS SubscribedChannels (
      channelId TEXT PRIMARY KEY,
      channelName TEXT NOT NULL,
      avatarUrl TEXT,
      subscribedAt INTEGER NOT NULL
    );
  `);
};
