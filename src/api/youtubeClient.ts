import './polyfills';
import { Innertube, Platform } from 'youtubei.js';
import axios from 'axios';
import { getStoredCredentials, removeCredentials } from '../auth/authStorage';
import { setCachedMetadata } from '../database/repositories/cacheRepo';
import {
  searchInnerTubeDirect,
  extractInnerTubeStreamDirect,
  fetchRelatedVideosDirect,
} from './mediaServiceCore';
import { AppVideoItem, StreamFormatOption, PlayableStreamResult, VideoComment } from './types';

// Re-export types for backward compatibility across the app
export * from './types';

let innertubeInstance: Innertube | null = null;
let isInitializing = false;

// Fast in-memory cache for InnerTube session & cipher keys
class MemoryCache {
  private store = new Map<string, ArrayBuffer>();
  async get(key: string): Promise<ArrayBuffer | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: ArrayBuffer): Promise<void> {
    this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const WORKING_PIPED_INSTANCES = [
  'https://pa.il.ax',
  'https://piped.video',
  'https://api.piped.projectsegfau.lt',
];

/**
 * Fallback Stream Extractor from active Piped instances
 */
const fetchFallbackStreamFromInstances = async (videoId: string) => {
  for (const instance of WORKING_PIPED_INSTANCES) {
    try {
      const res = await axios.get(`${instance}/streams/${videoId}`, {
        timeout: 4000,
      });
      const data = res.data;
      if (data) {
        const videoStreams = data.videoStreams || [];
        const audioStreams = data.audioStreams || [];
        const hlsUrl = data.hls;

        const bestProg = videoStreams.find((s: any) => s.videoOnly === false) || videoStreams[0];
        const streamUrl = bestProg?.url || hlsUrl || '';
        const bestAudio = audioStreams[0]?.url;

        const qualities: StreamFormatOption[] = videoStreams.map((f: any) => ({
          qualityLabel: f.quality || `${f.height}p` || '720p',
          url: f.url,
          hasVideo: true,
          hasAudio: !f.videoOnly,
          mimeType: f.mimeType,
          bitrate: f.bitrate,
        }));

        if (streamUrl) {
          return {
            streamUrl,
            audioStreamUrl: bestAudio,
            availableQualities: qualities,
          };
        }
      }
    } catch {
      // Continue to next mirror
    }
  }
  return null;
};

/**
 * Singleton Innertube Client with auto sign-in restoration & memory cache
 */
export const getYouTubeClient = async (): Promise<Innertube> => {
  if (innertubeInstance) {
    return innertubeInstance;
  }

  if (isInitializing) {
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (innertubeInstance) return innertubeInstance;
  }

  isInitializing = true;
  try {
    if (Platform?.shim) {
      Platform.shim.server = true;
      Platform.shim.eval = (data: any) => {
        const code = typeof data === 'string' ? data : (data?.output || '');
        const fn = new Function(code);
        return fn();
      };
    }

    innertubeInstance = await Innertube.create({
      cache: new MemoryCache() as any,
      generate_session_locally: true,
    });

    const savedCredentials = await getStoredCredentials();
    if (savedCredentials) {
      try {
        await innertubeInstance.session.signIn(savedCredentials);
      } catch (err) {
        console.warn('Session sign-in with saved credentials failed, clearing:', err);
        await removeCredentials();
      }
    }
  } catch (error) {
    console.error('Failed to initialize Innertube client:', error);
    throw error;
  } finally {
    isInitializing = false;
  }

  return innertubeInstance;
};

// 1. Fetch Home Feed (Personalized if signed in, Direct InnerTube Trending if signed out)
export const fetchTrendingFeed = async (): Promise<AppVideoItem[]> => {
  // Only attempt personalized feed if user has actual stored credentials
  const storedCreds = await getStoredCredentials();

  if (storedCreds) {
    try {
      const yt = await getYouTubeClient();
      if (yt.session.logged_in) {
        const feed = await yt.getHomeFeed();
        const videos = feed.videos || [];
        if (videos.length > 0) {
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
              duration: v.duration?.text,
              durationSeconds: v.duration?.seconds,
              published: v.published?.text,
              viewCount: v.views?.text || v.short_view_count?.text,
            };
          });
        }
      }
    } catch {
      // Personalized feed unavailable — silently fall through to trending
    }
  }

  // Fast, unthrottled Direct InnerTube Trending Feed (MediaServiceCore)
  const directVideos = await searchInnerTubeDirect('trending videos music');
  if (directVideos && directVideos.length > 0) {
    return directVideos;
  }

  return searchInnerTubeDirect('trending now');
};

// 2. Search Videos via Direct MediaServiceCore
export const searchYouTubeVideos = async (query: string): Promise<AppVideoItem[]> => {
  return searchInnerTubeDirect(query);
};

// 3. Extract Direct Playable Stream URL (SmartTube direct InnerTube pipeline)
export const extractPlayableStream = async (videoId: string): Promise<PlayableStreamResult> => {
  // Tier 1: Direct InnerTube Android SDK-less player request (Yuliskov / SmartTube architecture)
  // Delivers instant playback streams without 400 errors, cipher evaluation delays, or SABR blocking
  try {
    const directResult = await extractInnerTubeStreamDirect(videoId);
    if (directResult && directResult.streamUrl) {
      try {
        await setCachedMetadata(
          videoId,
          directResult.title,
          directResult.author,
          directResult.thumbnailUrl,
          directResult.durationSeconds
        );
      } catch {
        // Ignore cache write error
      }
      return directResult;
    }
  } catch (e) {
    console.warn('[extractPlayableStream] Direct InnerTube stream extraction failed, trying Innertube:', e);
  }

  // Tier 2: Innertube client fallback
  let rawUrl = '';
  let format: any = null;
  let audioStreamUrl: string | undefined;
  const availableQualities: StreamFormatOption[] = [];
  let info: any = null;

  try {
    const yt = await getYouTubeClient();
    info = await yt.getInfo(videoId);

    if (info) {
      // 1. Try progressive combined stream (Video + Audio)
      try {
        format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
        if (format) {
          rawUrl = await format.decipher(yt.session.player);
        }
      } catch {
        // Ignore format matching error
      }

      // 2. Try HLS stream if available
      if (!rawUrl && info.streaming_data?.hls_manifest_url) {
        rawUrl = info.streaming_data.hls_manifest_url;
      }

      // 3. Try iterating formats list in streaming_data
      if (!rawUrl && info.streaming_data?.formats?.length) {
        for (const fmt of info.streaming_data.formats) {
          try {
            const deciphered = await fmt.decipher(yt.session.player);
            if (deciphered) {
              rawUrl = deciphered;
              format = fmt;
              break;
            }
          } catch {
            // Continue
          }
        }
      }

      // 4. Try adaptive video format
      if (!rawUrl) {
        try {
          const videoOnly = info.chooseFormat({ type: 'video', quality: 'best' });
          if (videoOnly) {
            rawUrl = await videoOnly.decipher(yt.session.player);
            format = videoOnly;
          }
        } catch {
          // Ignore
        }
      }

      // Extract Audio-only stream
      try {
        const audioFormat = info.chooseFormat({ type: 'audio', quality: 'best' });
        if (audioFormat) {
          audioStreamUrl = await audioFormat.decipher(yt.session.player);
        }
      } catch {
        // Ignore
      }

      // Parse all available stream qualities
      if (info.streaming_data?.formats) {
        for (const fmt of info.streaming_data.formats) {
          try {
            const decipheredUrl = await fmt.decipher(yt.session.player);
            if (decipheredUrl) {
              availableQualities.push({
                qualityLabel: fmt.quality_label || `${fmt.height}p` || 'Auto',
                url: decipheredUrl,
                hasVideo: fmt.has_video,
                hasAudio: fmt.has_audio,
                mimeType: fmt.mime_type,
                bitrate: fmt.bitrate,
              });
            }
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch (e) {
    console.warn('[extractPlayableStream] Innertube fallback error:', e);
  }

  // Tier 3: If still no URL, query working Piped mirrors
  if (!rawUrl) {
    const fallback = await fetchFallbackStreamFromInstances(videoId);
    if (fallback) {
      rawUrl = fallback.streamUrl;
      if (fallback.audioStreamUrl && !audioStreamUrl) {
        audioStreamUrl = fallback.audioStreamUrl;
      }
      if (fallback.availableQualities?.length) {
        availableQualities.push(...fallback.availableQualities);
      }
    }
  }

  const thumbnails = info?.basic_info?.thumbnail || [];
  const bestThumbnail =
    thumbnails[thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const title = info?.basic_info?.title || 'YouTube Video';
  const author = info?.basic_info?.author || 'YouTube Creator';
  const duration = info?.basic_info?.duration || 0;

  try {
    await setCachedMetadata(videoId, title, author, bestThumbnail, duration);
  } catch {
    // Ignore
  }

  if (!rawUrl) {
    throw new Error('Unable to decipher playable stream for this video.');
  }

  const rawCaptions = (info as any)?.captions?.caption_tracks || [];
  const captionTracks = rawCaptions
    .filter((c: any) => c.base_url)
    .map((c: any) => ({
      id: c.language_code || 'en',
      languageCode: c.language_code || 'en',
      label: c.name?.text || c.language_code || 'English',
      baseUrl: c.base_url || '',
      isAutoGenerated: c.kind === 'asr',
    }));

  return {
    videoId: info?.basic_info?.id || videoId,
    title,
    author,
    authorAvatar: (info?.basic_info as any)?.channel?.thumbnails?.[0]?.url,
    channelId: info?.basic_info?.channel_id,
    description: info?.basic_info?.short_description || '',
    durationSeconds: duration,
    thumbnailUrl: bestThumbnail,
    streamUrl: rawUrl,
    audioStreamUrl,
    downloadUrl: rawUrl,
    captionTracks,
    availableQualities,
    qualityLabel: format?.quality_label || '720p',
    views: info?.basic_info?.view_count?.toString(),
    published: info?.basic_info?.is_live ? 'Live' : undefined,
  };
};

// 4. Fetch Video Comments
export const fetchVideoComments = async (videoId: string): Promise<VideoComment[]> => {
  try {
    const yt = await getYouTubeClient();
    const commentsData = await yt.getComments(videoId);
    const contents = commentsData.contents || [];

    return contents.slice(0, 25).map((item: any) => {
      const comment = item.comment;
      return {
        id: comment?.comment_id || Math.random().toString(),
        author: comment?.author?.name || 'User',
        authorAvatar: comment?.author?.thumbnails?.[0]?.url,
        text: comment?.content?.text || '',
        published: comment?.published?.text,
        likeCount: comment?.like_count?.toString() || '0',
      };
    });
  } catch {
    // Comments failure should never block or crash player
    return [];
  }
};

// 5. Fetch Related / Recommended Videos for a Video (Uses Direct InnerTube to prevent 400 errors)
export const fetchRelatedVideos = async (
  videoId: string,
  videoTitle?: string
): Promise<AppVideoItem[]> => {
  return fetchRelatedVideosDirect(videoId, videoTitle);
};
