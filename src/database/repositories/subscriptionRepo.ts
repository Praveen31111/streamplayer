import { getDb } from '../db';

export interface SubscribedChannelItem {
  channelId: string;
  channelName: string;
  avatarUrl?: string;
  subscribedAt: number;
}

export const saveChannelSubscription = async (
  channelId: string,
  channelName: string,
  avatarUrl?: string
): Promise<void> => {
  if (!channelId) return;
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO SubscribedChannels (channelId, channelName, avatarUrl, subscribedAt)
     VALUES (?, ?, ?, ?);`,
    [channelId, channelName || 'Channel', avatarUrl || '', Date.now()]
  );
};

export const removeChannelSubscription = async (channelId: string): Promise<void> => {
  if (!channelId) return;
  const db = await getDb();
  await db.runAsync(`DELETE FROM SubscribedChannels WHERE channelId = ?;`, [channelId]);
};

export const isChannelSubscribed = async (channelId: string): Promise<boolean> => {
  if (!channelId) return false;
  const db = await getDb();
  const res = await db.getFirstAsync<{ channelId: string }>(
    `SELECT channelId FROM SubscribedChannels WHERE channelId = ?;`,
    [channelId]
  );
  return !!res;
};

export const getSubscribedChannels = async (): Promise<SubscribedChannelItem[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<SubscribedChannelItem>(
    `SELECT * FROM SubscribedChannels ORDER BY subscribedAt DESC;`
  );
  return rows || [];
};
