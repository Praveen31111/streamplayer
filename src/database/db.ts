import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (dbInstance) {
    return dbInstance;
  }

  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync('custom_player.db');
        try {
          // Enable Write-Ahead Logging (WAL) for safe concurrent reads & writes on Android
          await db.execAsync('PRAGMA journal_mode = WAL;');
        } catch (pragmaErr) {
          console.warn('[Database] WAL PRAGMA note:', pragmaErr);
        }
        try {
          await initializeTables(db);
        } catch (tableErr) {
          console.warn('[Database] initializeTables note:', tableErr);
        }
        dbInstance = db;
        return db;
      } catch (error) {
        dbInitPromise = null;
        console.error('[Database] Failed to open SQLite database:', error);
        throw error;
      }
    })();
  }

  return dbInitPromise;
};

const initializeTables = async (db: SQLite.SQLiteDatabase) => {
  // Execute all table creation scripts in a single atomic batch
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS CacheMetadata (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnailUrl TEXT,
      duration INTEGER,
      cachedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS WatchHistory (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnailUrl TEXT,
      lastPositionMillis INTEGER DEFAULT 0,
      totalDurationMillis INTEGER DEFAULT 0,
      updatedAt INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS SavedBookmarks (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnailUrl TEXT,
      savedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS SubscribedChannels (
      channelId TEXT PRIMARY KEY,
      channelName TEXT NOT NULL,
      avatarUrl TEXT,
      subscribedAt INTEGER NOT NULL
    );
  `);
};
