import axios from 'axios';
import {
  AppVideoItem,
  PlayableStreamResult,
  StreamFormatOption,
  CaptionTrackOption,
  ChannelDetails,
  ChannelPlaylistItem,
} from './types';

// Android Client configuration (Yuliskov / SmartTube / yt-dlp sdkless architecture)
// Bypasses bot restrictions, PoToken enforcement, and cipher deciphering
const ANDROID_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '20.10.38',
  userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
  osName: 'Android',
  osVersion: '11',
  hl: 'en',
  gl: 'IN',
};

const ANDROID_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
  'X-YouTube-Client-Name': '3',
  'X-YouTube-Client-Version': '20.10.38',
};

const WEB_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20240101.00.00',
  hl: 'en',
  gl: 'IN',
};

const WEB_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'X-YouTube-Client-Name': '1',
  'X-YouTube-Client-Version': '2.20240101.00.00',
  Origin: 'https://www.youtube.com',
  Referer: 'https://www.youtube.com/',
};

/**
 * 1. Search Videos via Direct InnerTube (Fast, no 400 error)
 */
export const searchInnerTubeDirect = async (query: string): Promise<AppVideoItem[]> => {
  if (!query.trim()) return [];

  try {
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/search',
      {
        context: { client: WEB_CLIENT },
        query,
      },
      { headers: WEB_HEADERS, timeout: 6000 }
    );

    const sections =
      res.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents || [];

    const videos: AppVideoItem[] = [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (v && v.videoId) {
          const thumbnails = v.thumbnail?.thumbnails || [];
          const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || '';
          const authorAvatar =
            v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail
              ?.thumbnails?.[0]?.url;

          videos.push({
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Untitled',
            author: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || 'YouTube Channel',
            authorAvatar,
            channelId: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId,
            thumbnail: bestThumbnail,
            duration: v.lengthText?.simpleText,
            published: v.publishedTimeText?.simpleText,
            viewCount: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText,
          });
        }
      }
    }

    return videos;
  } catch (error) {
    console.error('[MediaServiceCore] Direct InnerTube search error:', error);
    return [];
  }
};

/**
 * 2. Direct InnerTube Playable Stream Extractor with ExoPlayer DASH Engine
 * Extracts 4K, 1440p, 1080p, 720p, 480p, 360p with synchronized audio
 */
export const extractInnerTubeStreamDirect = async (
  videoId: string
): Promise<PlayableStreamResult | null> => {
  try {
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json',
      {
        videoId,
        context: { client: ANDROID_CLIENT },
      },
      { headers: ANDROID_HEADERS, timeout: 7000 }
    );

    const data = res.data;
    if (data?.playabilityStatus?.status !== 'OK') {
      return null;
    }

    const formats: any[] = data.streamingData?.formats || [];
    const adaptive: any[] = data.streamingData?.adaptiveFormats || [];
    const hlsUrl = data.streamingData?.hlsManifestUrl;

    const validFormats = formats.filter(f => f.url);
    const validAdaptive = adaptive.filter(f => f.url);

    if (validFormats.length === 0 && validAdaptive.length === 0 && !hlsUrl) {
      return null;
    }

    const rawVideoMp4 = validAdaptive.filter(
      (f: any) => f.mimeType?.startsWith('video/mp4') && f.initRange && f.indexRange
    );

    // Filter and normalize audio formats with multi-language metadata
    const rawAudioMp4 = validAdaptive
      .filter((f: any) => f.mimeType?.startsWith('audio/mp4') && f.initRange && f.indexRange)
      .map((f: any) => {
        const trackId = f.audioTrack?.id || f.language || 'default';
        const trackLabel = f.audioTrack?.displayName || (f.audioTrack?.audioIsDefault ? 'Original' : 'Audio Track');
        const langCode = f.audioTrack?.id?.split('.')[0] || f.language || 'en';
        const isDefault = Boolean(f.audioTrack?.audioIsDefault || trackId === 'default');

        return {
          ...f,
          audioTrackId: trackId,
          audioTrackLabel: trackLabel,
          audioLanguage: langCode,
          isDefaultAudio: isDefault,
        };
      });

    // Build unique availableAudioTracks list
    const audioTrackMap = new Map<string, any>();
    for (const af of rawAudioMp4) {
      const key = af.audioTrackId || af.audioLanguage || 'default';
      if (!audioTrackMap.has(key)) {
        audioTrackMap.set(key, {
          id: key,
          label: af.audioTrackLabel || 'Original Audio',
          language: af.audioLanguage || 'en',
          url: af.url,
          isDefault: af.isDefaultAudio,
          mimeType: af.mimeType,
          bitrate: af.bitrate,
        });
      }
    }
    const availableAudioTracks = Array.from(audioTrackMap.values());
    const defaultAudioTrack = availableAudioTracks.find(t => t.isDefault) || availableAudioTracks[0];

    // Build deduplicated qualities list sorted from highest (4K) to lowest (144p)
    const qualityMap = new Map<string, StreamFormatOption>();

    for (const f of validFormats) {
      if (f.qualityLabel && !qualityMap.has(f.qualityLabel)) {
        qualityMap.set(f.qualityLabel, {
          qualityLabel: f.qualityLabel,
          url: f.url,
          hasVideo: true,
          hasAudio: true,
          mimeType: f.mimeType,
          bitrate: f.bitrate,
        });
      }
    }

    // Keep adaptive video-only formats as a fallback, but prefer combined formats
    // for every quality so a quality switch never drops the audio track.
    for (const f of rawVideoMp4) {
      if (f.qualityLabel && !qualityMap.has(f.qualityLabel)) {
        qualityMap.set(f.qualityLabel, {
          qualityLabel: f.qualityLabel,
          url: f.url,
          hasVideo: true,
          hasAudio: false,
          mimeType: f.mimeType,
          bitrate: f.bitrate,
        });
      }
    }

    const order = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
    const availableQualities = Array.from(qualityMap.values()).sort((a, b) => {
      const idxA = order.findIndex(o => a.qualityLabel.includes(o));
      const idxB = order.findIndex(o => b.qualityLabel.includes(o));
      const posA = idxA === -1 ? 99 : idxA;
      const posB = idxB === -1 ? 99 : idxB;
      return posA - posB;
    });

    const bestProgressive = validFormats[validFormats.length - 1] || validFormats[0];
    const bestAdaptiveVideo = validAdaptive.find(f => f.mimeType?.includes('video'));
    const audioStream = defaultAudioTrack?.url || validAdaptive.find(f => f.mimeType?.includes('audio'))?.url;

    const videoDetails = data.videoDetails || {};
    const durationSeconds = parseInt(videoDetails.lengthSeconds || '0', 10);

    const streamUrl = bestProgressive?.url || hlsUrl || bestAdaptiveVideo?.url;
    if (!streamUrl) return null;

    const thumbnails = videoDetails.thumbnail?.thumbnails || [];
    const bestThumbnail =
      thumbnails[thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // Extract Subtitle / Closed Caption tracks
    const rawCaptions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const captionTracks: CaptionTrackOption[] = rawCaptions
      .filter((c: any) => c.baseUrl)
      .map((c: any) => {
        const langName = c.name?.runs?.[0]?.text || c.name?.simpleText || c.languageCode || 'Unknown';
        const isAuto = c.kind === 'asr';
        return {
          id: c.vssId || `${c.languageCode}_${isAuto ? 'asr' : 'std'}`,
          languageCode: c.languageCode,
          label: isAuto ? `${langName} (auto)` : langName,
          baseUrl: c.baseUrl,
          isAutoGenerated: isAuto,
        };
      });

    return {
      videoId,
      title: videoDetails.title || 'YouTube Video',
      author: videoDetails.author || 'YouTube Creator',
      channelId: videoDetails.channelId,
      description: videoDetails.shortDescription || '',
      durationSeconds,
      thumbnailUrl: bestThumbnail,
      streamUrl,
      audioStreamUrl: audioStream,
      audioTracks: availableAudioTracks,
      activeAudioTrackId: defaultAudioTrack?.id,
      downloadUrl: bestProgressive?.url || validFormats[0]?.url || validAdaptive.find(f => f.url)?.url || streamUrl,
      captionTracks,
      contentType: bestProgressive ? 'progressive' : hlsUrl ? 'hls' : 'auto',
      availableQualities,
      qualityLabel: availableQualities[0]?.qualityLabel || bestProgressive?.qualityLabel || '720p',
      views: videoDetails.viewCount,
      rawVideoFormats: rawVideoMp4,
      rawAudioFormats: rawAudioMp4,
    };
  } catch (error) {
    console.warn('[MediaServiceCore] Direct stream extraction error:', error);
    return null;
  }
};

/**
 * 3. Fetch Related Videos via Direct InnerTube (No 400 error)
 */
export const fetchRelatedVideosDirect = async (
  videoId: string,
  videoTitle?: string
): Promise<AppVideoItem[]> => {
  try {
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/next?prettyPrint=false&alt=json',
      {
        videoId,
        context: { client: ANDROID_CLIENT },
      },
      { headers: ANDROID_HEADERS, timeout: 5000 }
    );

    const relatedVideos: AppVideoItem[] = [];
    const contents =
      res.data?.contents?.singleColumnWatchNextResults?.results?.results?.contents ||
      res.data?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ||
      [];

    for (const section of contents) {
      const items =
        section?.itemSectionRenderer?.contents ||
        (section?.compactVideoRenderer ? [section] : []);

      for (const item of items) {
        const v = item?.compactVideoRenderer || item?.videoWithContextRenderer;
        if (v && v.videoId && v.videoId !== videoId) {
          const thumbnails = v.thumbnail?.thumbnails || [];
          const bestThumbnail =
            thumbnails[thumbnails.length - 1]?.url ||
            `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

          relatedVideos.push({
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Untitled',
            author:
              v.shortBylineText?.runs?.[0]?.text ||
              v.longBylineText?.runs?.[0]?.text ||
              'YouTube Channel',
            authorAvatar:
              v.channelThumbnail?.thumbnails?.[0]?.url ||
              v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail
                ?.thumbnails?.[0]?.url,
            channelId: v.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId,
            thumbnail: bestThumbnail,
            duration: v.lengthText?.simpleText,
            published: v.publishedTimeText?.simpleText,
            viewCount: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText,
          });
        }
      }
    }

    if (relatedVideos.length > 0) {
      return relatedVideos.slice(0, 20);
    }
  } catch {
    // Fallback to search if next is unavailable
  }

  const query = videoTitle ? videoTitle.split('|')[0].trim() : 'trending songs';
  const searchResults = await searchInnerTubeDirect(query);
  return searchResults.filter(v => v.id !== videoId).slice(0, 20);
};

/**
 * 4. Fetch Complete Channel Profile, Videos & Playlists via Direct InnerTube
 */
export const fetchChannelDetailsDirect = async (
  channelId: string
): Promise<ChannelDetails | null> => {
  if (!channelId) return null;

  try {
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json',
      {
        browseId: channelId,
        context: { client: ANDROID_CLIENT },
      },
      { headers: ANDROID_HEADERS, timeout: 7000 }
    );

    const data = res.data;
    if (!data) return null;

    // 1. Channel Header
    const header = data.header?.c4TabbedHeaderRenderer || data.header?.pageHeaderRenderer || {};
    const title =
      header.title ||
      header.pageTitle?.runs?.[0]?.text ||
      header.pageTitle?.simpleText ||
      'YouTube Channel';

    const avatarThumbnails =
      header.avatar?.thumbnails ||
      header.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel
        ?.image?.sources ||
      [];
    const avatar =
      avatarThumbnails[avatarThumbnails.length - 1]?.url ||
      avatarThumbnails[0]?.url ||
      undefined;

    const bannerThumbnails =
      header.banner?.thumbnails ||
      header.tvBanner?.thumbnails ||
      header.mobileBanner?.thumbnails ||
      [];
    const banner =
      bannerThumbnails[bannerThumbnails.length - 1]?.url ||
      bannerThumbnails[0]?.url ||
      undefined;

    const subscriberCount =
      header.subscriberCountText?.simpleText ||
      header.subscriberCountText?.runs?.[0]?.text ||
      '';

    const videosCount =
      header.videosCountText?.runs?.[0]?.text ||
      header.videosCountText?.simpleText ||
      '';

    const description =
      header.description?.simpleText ||
      header.tagline?.runs?.[0]?.text ||
      '';

    // 2. Channel Videos & Playlists from Tabs
    const tabs =
      data.contents?.singleColumnBrowseResultsRenderer?.tabs ||
      data.contents?.twoColumnBrowseResultsRenderer?.tabs ||
      [];

    const videos: AppVideoItem[] = [];
    const playlists: ChannelPlaylistItem[] = [];

    for (const tab of tabs) {
      const tabRenderer = tab.tabRenderer;
      const tabTitle = (tabRenderer?.title || '').toLowerCase();
      const content = tabRenderer?.content;

      // Extract Videos (from Home or Videos tab)
      if (tabTitle.includes('video') || tabTitle.includes('home') || !tabTitle) {
        const sections =
          content?.sectionListRenderer?.contents ||
          content?.richGridRenderer?.contents ||
          [];

        for (const sec of sections) {
          const items =
            sec?.itemSectionRenderer?.contents?.[0]?.gridRenderer?.items ||
            sec?.itemSectionRenderer?.contents ||
            sec?.richItemRenderer?.content ? [sec?.richItemRenderer?.content] : [];

          for (const item of items) {
            const v = item?.gridVideoRenderer || item?.videoRenderer || item?.compactVideoRenderer;
            if (v && v.videoId) {
              const thumbs = v.thumbnail?.thumbnails || [];
              const bestThumb = thumbs[thumbs.length - 1]?.url || '';

              videos.push({
                id: v.videoId,
                title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Untitled',
                author: title,
                authorAvatar: avatar,
                channelId,
                thumbnail: bestThumb,
                duration: v.lengthText?.simpleText,
                published: v.publishedTimeText?.simpleText,
                viewCount: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText,
              });
            }
          }
        }
      }

      // Extract Playlists
      if (tabTitle.includes('playlist')) {
        const sections = content?.sectionListRenderer?.contents || [];
        for (const sec of sections) {
          const items =
            sec?.itemSectionRenderer?.contents?.[0]?.gridRenderer?.items ||
            sec?.itemSectionRenderer?.contents ||
            [];

          for (const item of items) {
            const p = item?.gridPlaylistRenderer || item?.playlistRenderer;
            if (p && p.playlistId) {
              const thumbs = p.thumbnail?.thumbnails || [];
              playlists.push({
                id: p.playlistId,
                title: p.title?.runs?.[0]?.text || p.title?.simpleText || 'Playlist',
                videoCount: p.videoCountText?.runs?.[0]?.text || p.videoCountShortText?.simpleText,
                thumbnail: thumbs[thumbs.length - 1]?.url,
              });
            }
          }
        }
      }
    }

    // If videos were not found in tabs, fallback to searching videos by channel title
    if (videos.length === 0) {
      const fallbackSearch = await searchInnerTubeDirect(title);
      videos.push(...fallbackSearch);
    }

    return {
      id: channelId,
      title,
      avatar,
      banner,
      subscriberCount,
      videosCount,
      description,
      videos: videos.slice(0, 40),
      playlists: playlists.slice(0, 20),
    };
  } catch (err) {
    console.warn('[MediaServiceCore] Failed to fetch channel details:', err);
    return null;
  }
};
