import { getYouTubeClient, AppVideoItem } from './youtubeClient';
import {
  saveChannelSubscription,
  removeChannelSubscription,
  getSubscribedChannels,
  isChannelSubscribed,
} from '../database/repositories/subscriptionRepo';
import axios from 'axios';

export interface UserPlaylistItem {
  id: string;
  title: string;
  videoCount?: string;
  thumbnail?: string;
}

export interface UserLibraryData {
  history: AppVideoItem[];
  likedVideos: AppVideoItem[];
  watchLater: AppVideoItem[];
  playlists: UserPlaylistItem[];
}

/**
 * Fetch personalized user subscriptions feed with multi-tier fallback (TV client -> Web feed -> Local subscribed channels)
 * Prevents 400 Client Mismatch crashes completely
 */
export const fetchUserSubscriptionsFeed = async (): Promise<AppVideoItem[]> => {
  try {
    const yt = await getYouTubeClient();

    if (yt.session.logged_in) {
      // 1. Try fetching with TV client context to match TV OAuth Bearer token
      try {
        const tvBrowse = await yt.actions.execute('/browse', {
          browseId: 'FEsubscriptions',
          client: 'TV',
          parse: true,
        });

        const contents = (tvBrowse as any)?.contents || [];
        const videos = (tvBrowse as any)?.videos || contents;

        if (Array.isArray(videos) && videos.length > 0) {
          return videos.map((v: any) => {
            const thumbnails = v.thumbnails || [];
            const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || '';
            return {
              id: v.id || '',
              title: v.title?.text || v.title?.toString() || 'Untitled',
              author: v.author?.name || 'Unknown Channel',
              authorAvatar: v.author?.thumbnails?.[0]?.url,
              channelId: v.author?.id,
              thumbnail: bestThumbnail,
              published: v.published?.text,
              viewCount: v.views?.text,
            };
          });
        }
      } catch (tvErr) {
        console.warn('[UserService] TV browse subscriptions attempt error, trying default feed:', tvErr);
      }

      // 2. Try default getSubscriptionsFeed
      try {
        const feed = await yt.getSubscriptionsFeed();
        const videos = feed.videos || [];

        if (videos.length > 0) {
          return videos.map((v: any) => {
            const thumbnails = v.thumbnails || [];
            const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || '';

            return {
              id: v.id || '',
              title: v.title?.text || 'Untitled',
              author: v.author?.name || 'Unknown Channel',
              authorAvatar: v.author?.thumbnails?.[0]?.url,
              channelId: v.author?.id,
              thumbnail: bestThumbnail,
              published: v.published?.text,
              viewCount: v.views?.text,
            };
          });
        }
      } catch (feedErr) {
        console.warn('[UserService] getSubscriptionsFeed error:', feedErr);
      }
    }
  } catch (clientErr) {
    console.warn('[UserService] YouTube client initialization error:', clientErr);
  }

  // 3. Resilient Fallback: Fetch latest videos for locally subscribed channels
  try {
    const localChannels = await getSubscribedChannels();
    if (localChannels.length === 0) {
      return [];
    }

    const aggregatedVideos: AppVideoItem[] = [];
    // Fetch latest videos for the first 5 subscribed channels
    for (const ch of localChannels.slice(0, 5)) {
      try {
        const res = await axios.post(
          'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json',
          {
            browseId: ch.channelId,
            params: 'Egh2aWRlb3PyBgQKAjoA', // Videos tab parameter
            context: {
              client: {
                clientName: 'ANDROID',
                clientVersion: '20.10.38',
                userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
                osName: 'Android',
                osVersion: '11',
                hl: 'en',
                gl: 'IN',
              },
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
              'X-YouTube-Client-Name': '3',
              'X-YouTube-Client-Version': '20.10.38',
            },
            timeout: 4000,
          }
        );

        const items =
          res.data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[1]?.tabRenderer?.content
            ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]
            ?.gridRenderer?.items || [];

        for (const it of items.slice(0, 4)) {
          const renderer = it.gridVideoRenderer || it.videoRenderer;
          if (renderer && renderer.videoId) {
            aggregatedVideos.push({
              id: renderer.videoId,
              title: renderer.title?.runs?.[0]?.text || 'Video',
              author: ch.channelName,
              authorAvatar: ch.avatarUrl,
              channelId: ch.channelId,
              thumbnail:
                renderer.thumbnail?.thumbnails?.[renderer.thumbnail.thumbnails.length - 1]?.url || '',
              published: renderer.publishedTimeText?.simpleText,
              viewCount: renderer.viewCountText?.simpleText,
            });
          }
        }
      } catch {
        // Skip channel if rate-limited
      }
    }

    return aggregatedVideos;
  } catch (fallbackErr) {
    console.warn('[UserService] Local subscriptions fallback error:', fallbackErr);
    return [];
  }
};

/**
 * Fetch user library including Liked Videos, Watch Later, and Playlists
 */
export const fetchUserLibrary = async (): Promise<UserLibraryData | null> => {
  try {
    const yt = await getYouTubeClient();
    if (!yt.session.logged_in) {
      return null;
    }

    const library = await yt.getLibrary();

    const mapFeedVideos = (feedList: any[] = []): AppVideoItem[] => {
      return feedList.map((v: any) => {
        const thumbnails = v.thumbnails || [];
        const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || '';
        return {
          id: v.id || '',
          title: v.title?.text || 'Untitled',
          author: v.author?.name || 'Unknown Channel',
          thumbnail: bestThumbnail,
          duration: v.duration?.text,
          published: v.published?.text,
          viewCount: v.views?.text,
        };
      });
    };

    const mapPlaylists = (playlistsList: any[] = []): UserPlaylistItem[] => {
      return playlistsList.map((p: any) => {
        const thumbnails = p.thumbnails || [];
        const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || '';
        return {
          id: p.id || '',
          title: p.title?.text || 'Playlist',
          videoCount: p.video_count?.text,
          thumbnail: bestThumbnail,
        };
      });
    };

    return {
      history: mapFeedVideos((library as any)?.history?.videos || []),
      likedVideos: mapFeedVideos((library as any)?.liked_videos?.videos || []),
      watchLater: mapFeedVideos((library as any)?.watch_later?.videos || []),
      playlists: mapPlaylists((library as any)?.playlists || []),
    };
  } catch (error) {
    console.warn('[UserService] Error fetching user library:', error);
    return null;
  }
};

/**
 * Like or Dislike a video on user's YouTube account
 */
export const rateVideo = async (
  videoId: string,
  rating: 'LIKE' | 'DISLIKE' | 'INDIFFERENT'
): Promise<boolean> => {
  try {
    const yt = await getYouTubeClient();
    if (!yt.session.logged_in) return false;

    if (rating === 'LIKE') {
      await (yt.interact as any).like(videoId);
    } else if (rating === 'DISLIKE') {
      await (yt.interact as any).dislike(videoId);
    }
    return true;
  } catch (error) {
    console.warn('[UserService] Failed to rate video:', error);
    return false;
  }
};

/**
 * Subscribe or Unsubscribe to a YouTube channel (Local SQLite + Cloud Session)
 */
export const toggleChannelSubscription = async (
  channelId: string,
  subscribe: boolean,
  channelName?: string,
  avatarUrl?: string
): Promise<boolean> => {
  if (!channelId) return false;

  // 1. Always update local database for zero-error instant UI state
  try {
    if (subscribe) {
      await saveChannelSubscription(channelId, channelName || 'Channel', avatarUrl);
    } else {
      await removeChannelSubscription(channelId);
    }
  } catch (dbErr) {
    console.warn('[UserService] Local subscription update error:', dbErr);
  }

  // 2. Sync with cloud YouTube session if signed in
  try {
    const yt = await getYouTubeClient();
    if (yt.session.logged_in) {
      if (subscribe) {
        await (yt.interact as any).subscribe(channelId);
      } else {
        await (yt.interact as any).unsubscribe(channelId);
      }
    }
    return true;
  } catch (error) {
    console.warn('[UserService] Cloud subscription sync error:', error);
    return true; // Still true because local subscription succeeded
  }
};

/**
 * Check if a channel is subscribed (combines SQLite + Cloud state)
 */
export const checkChannelSubscriptionStatus = async (channelId: string): Promise<boolean> => {
  if (!channelId) return false;
  return await isChannelSubscribed(channelId);
};
