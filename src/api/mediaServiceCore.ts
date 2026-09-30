import axios from 'axios';
import {
  AppVideoItem,
  PaginatedVideosResult,
  PlayableStreamResult,
  StreamFormatOption,
  CaptionTrackOption,
  ChannelDetails,
  ChannelPlaylistItem,
} from './types';
import {
  getActiveClientProfile,
  getActiveClientHeaders,
  rotateToNextClientProfile,
  ClientProfile,
} from './remoteConfig';
import { getPoTokenInfo } from '../auth/poTokenStorage';

// Dynamic Web Client fallback for Search and Channel browsing
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
 * Fetch raw InnerTube player data using a specified dynamic client profile
 */
const fetchInnerTubePlayerData = async (
  videoId: string,
  client: ClientProfile
): Promise<any> => {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': client.userAgent,
    'X-YouTube-Client-Name': client.clientNameHeader,
    'X-YouTube-Client-Version': client.clientVersion,
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
  };

  const poInfo = getPoTokenInfo();

  const payload: any = {
    videoId,
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        userAgent: client.userAgent,
        osName: client.osName || 'Android',
        osVersion: client.osVersion || '11',
        hl: client.hl || 'en',
        gl: client.gl || 'IN',
        ...(poInfo?.visitorData ? { visitorData: poInfo.visitorData } : {}),
      },
      ...(poInfo?.poToken
        ? {
            serviceIntegrityDimensions: {
              poToken: poInfo.poToken,
            },
          }
        : {}),
    },
  };

  const res = await axios.post(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json',
    payload,
    { headers, timeout: 6500 }
  );

  return res.data;
};

/**
 * Parse an InnerTube videoRenderer item into standard AppVideoItem
 */
export const parseVideoRenderer = (v: any): AppVideoItem | null => {
  if (!v || !v.videoId) return null;
  const thumbnails = v.thumbnail?.thumbnails || [];
  const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || '';
  const authorAvatar =
    v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail
      ?.thumbnails?.[0]?.url;

  return {
    id: v.videoId,
    title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Untitled',
    author: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || 'YouTube Channel',
    authorAvatar,
    channelId: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId,
    thumbnail: bestThumbnail,
    duration: v.lengthText?.simpleText,
    published: v.publishedTimeText?.simpleText,
    viewCount: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText,
  };
};

/**
 * 1. Search Videos with Infinite Pagination support (InnerTube continuation token)
 */
export const searchInnerTubeWithContinuation = async (
  query: string,
  continuationToken?: string
): Promise<PaginatedVideosResult> => {
  if (!query.trim() && !continuationToken) {
    return { videos: [] };
  }

  try {
    const videos: AppVideoItem[] = [];
    let nextContinuationToken: string | undefined;

    if (continuationToken) {
      const res = await axios.post(
        'https://www.youtube.com/youtubei/v1/search',
        {
          context: { client: WEB_CLIENT },
          continuation: continuationToken,
        },
        { headers: WEB_HEADERS, timeout: 7000 }
      );

      const continuationItems =
        res.data?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems ||
        res.data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ||
        res.data?.continuationContents?.sectionListContinuation?.contents ||
        [];

      for (const item of continuationItems) {
        if (item.continuationItemRenderer) {
          nextContinuationToken =
            item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        }

        const sectionContents =
          item.itemSectionRenderer?.contents ||
          item.sectionListRenderer?.contents ||
          [];

        for (const c of sectionContents) {
          if (c.continuationItemRenderer) {
            nextContinuationToken =
              c.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          }
          const v = parseVideoRenderer(c.videoRenderer || c.compactVideoRenderer || c.gridVideoRenderer);
          if (v && !videos.some(x => x.id === v.id)) {
            videos.push(v);
          }
        }

        if (item.videoRenderer) {
          const v = parseVideoRenderer(item.videoRenderer);
          if (v && !videos.some(x => x.id === v.id)) {
            videos.push(v);
          }
        }
      }
    } else {
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

      for (const section of sections) {
        if (section.continuationItemRenderer) {
          nextContinuationToken =
            section.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        }

        const items = section?.itemSectionRenderer?.contents || [];
        for (const item of items) {
          if (item.continuationItemRenderer) {
            nextContinuationToken =
              item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          }

          const v = parseVideoRenderer(item?.videoRenderer || item?.compactVideoRenderer);
          if (v && !videos.some(x => x.id === v.id)) {
            videos.push(v);
          }
        }
      }
    }

    return { videos, continuationToken: nextContinuationToken };
  } catch (error) {
    console.error('[MediaServiceCore] Direct InnerTube search error:', error);
    return { videos: [] };
  }
};

/**
 * 1b. Search Videos via Direct InnerTube (Fast, no 400 error, backward compatible)
 */
export const searchInnerTubeDirect = async (query: string): Promise<AppVideoItem[]> => {
  const result = await searchInnerTubeWithContinuation(query);
  return result.videos;
};

/**
 * 2. Direct InnerTube Playable Stream Extractor with ExoPlayer DASH Engine
 * Extracts 4K, 1440p, 1080p, 720p, 480p, 360p with synchronized audio
 */
export const extractInnerTubeStreamDirect = async (
  videoId: string
): Promise<PlayableStreamResult | null> => {
  try {
    let client = getActiveClientProfile();
    let data: any = null;

    try {
      data = await fetchInnerTubePlayerData(videoId, client);
    } catch {
      // First attempt failed, check for failover
    }

    const hasNoValidStreams = (d: any) => {
      if (!d || d.playabilityStatus?.status !== 'OK') return true;
      const formats: any[] = d.streamingData?.formats || [];
      const adaptive: any[] = d.streamingData?.adaptiveFormats || [];
      const hlsUrl = d.streamingData?.hlsManifestUrl;
      const validFormats = formats.filter(f => f.url);
      const validAdaptive = adaptive.filter(f => f.url);
      return validFormats.length === 0 && validAdaptive.length === 0 && !hlsUrl;
    };

    // If active client returned unplayable status or empty streams, Auto-Failover to next profile
    if (hasNoValidStreams(data)) {
      client = await rotateToNextClientProfile('Client unplayable or challenged');
      try {
        data = await fetchInnerTubePlayerData(videoId, client);
      } catch (e) {
        console.warn('[MediaServiceCore] Fallback client request failed:', e);
      }
    }

    if (hasNoValidStreams(data)) {
      return null;
    }

    const formats: any[] = data.streamingData?.formats || [];
    const adaptive: any[] = data.streamingData?.adaptiveFormats || [];
    const hlsUrl = data.streamingData?.hlsManifestUrl;

    const validFormats = formats.filter((f: any) => Boolean(f.url));
    const validAdaptive = adaptive.filter((f: any) => Boolean(f.url));

    // Extract all high-res adaptive video formats (MP4 and WebM VP9)
    const rawVideoFormats = validAdaptive.filter(
      (f: any) =>
        (f.mimeType?.startsWith('video/mp4') || f.mimeType?.startsWith('video/webm')) &&
        f.initRange &&
        f.indexRange
    );

    // Filter and normalize audio formats with multi-language metadata
    const rawAudioFormats = validAdaptive
      .filter(
        (f: any) =>
          (f.mimeType?.startsWith('audio/mp4') || f.mimeType?.startsWith('audio/webm')) &&
          f.initRange &&
          f.indexRange
      )
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
    for (const af of rawAudioFormats) {
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

    // Include adaptive video-only formats (1080p, 1440p, 4K)
    for (const f of rawVideoFormats) {
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

    const order = [
      '2160p60',
      '2160p',
      '1440p60',
      '1440p',
      '1080p60',
      '1080p',
      '720p60',
      '720p',
      '480p',
      '360p',
      '240p',
      '144p',
    ];
    const availableQualities = Array.from(qualityMap.values()).sort((a, b) => {
      const idxA = order.findIndex(o => a.qualityLabel.includes(o));
      const idxB = order.findIndex(o => b.qualityLabel.includes(o));
      const posA = idxA === -1 ? 99 : idxA;
      const posB = idxB === -1 ? 99 : idxB;
      return posA - posB;
    });

    // Prioritize high-quality progressive format (itag 22 for 720p or itag 18 for 360p)
    const format720p = validFormats.find(f => f.itag === 22 || (f.qualityLabel?.includes('720') && f.url));
    const format360p =
      validFormats.find(f => f.qualityLabel?.includes('360p') || f.itag === 18) ||
      validFormats[0];

    const bestProgressive = format720p || format360p || validFormats[0];
    const defaultQualityLabel = bestProgressive?.qualityLabel || '720p';
    const audioStream =
      defaultAudioTrack?.url || validAdaptive.find(f => f.mimeType?.includes('audio'))?.url;

    const videoDetails = data.videoDetails || {};
    const durationSeconds = parseInt(videoDetails.lengthSeconds || '0', 10);

    // CRITICAL FIX: Ensure streamUrl NEVER falls back to an audio-only stream (which causes Black Screen with Audio)
    // Only choose progressive video or first high-quality adaptive video format
    const fallbackVideo = rawVideoFormats[0]?.url || validAdaptive.find((f: any) => f.url && f.mimeType?.startsWith('video/'))?.url;
    const streamUrl = bestProgressive?.url || hlsUrl || fallbackVideo || '';
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
      contentType: 'progressive',
      availableQualities,
      qualityLabel: defaultQualityLabel,
      views: videoDetails.viewCount,
      rawVideoFormats,
      rawAudioFormats,
      clientUserAgent: client.userAgent,
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
    const client = getActiveClientProfile();
    const headers = getActiveClientHeaders();
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/next?prettyPrint=false&alt=json',
      {
        videoId,
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            userAgent: client.userAgent,
            osName: client.osName || 'Android',
            osVersion: client.osVersion || '11',
            hl: client.hl || 'en',
            gl: client.gl || 'IN',
          },
        },
      },
      { headers, timeout: 5000 }
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
 * Helper to parse a video item from either modern lockupViewModel or classic videoRenderer
 */
function extractVideoFromItem(rawItem: any, fallbackAuthor: string): AppVideoItem | null {
  if (!rawItem) return null;
  const l = rawItem.richItemRenderer?.content?.lockupViewModel || rawItem.lockupViewModel;
  if (l && l.contentId) {
    const meta = l.metadata?.lockupMetadataViewModel;
    const title = meta?.title?.content || 'Untitled';
    const parts = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts || [];
    const viewCount = parts[0]?.text?.content;
    const published = parts[1]?.text?.content;
    const thumbs = l.contentImage?.thumbnailViewModel?.image?.sources || [];
    const thumbnail = thumbs[thumbs.length - 1]?.url || '';
    const overlays = l.contentImage?.thumbnailViewModel?.overlays || [];
    const duration =
      overlays[0]?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text;

    return {
      id: l.contentId,
      title,
      author: fallbackAuthor,
      thumbnail,
      duration,
      published,
      viewCount,
    };
  }

  const v =
    rawItem.richItemRenderer?.content?.videoRenderer ||
    rawItem.videoRenderer ||
    rawItem.gridVideoRenderer ||
    rawItem.compactVideoRenderer;

  if (v && v.videoId) {
    const thumbs = v.thumbnail?.thumbnails || [];
    return {
      id: v.videoId,
      title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Untitled',
      author: fallbackAuthor,
      thumbnail: thumbs[thumbs.length - 1]?.url || '',
      duration: v.lengthText?.simpleText,
      published: v.publishedTimeText?.simpleText,
      viewCount: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText,
    };
  }

  return null;
}

/**
 * 4. Fetch Complete Channel Profile, Videos & Playlists via Direct InnerTube
 */
export const fetchChannelDetailsDirect = async (
  channelId: string
): Promise<ChannelDetails | null> => {
  if (!channelId) return null;

  try {
    // Attempt fetching the Videos tab directly (EgZ2aWRlb3PyBgQKAjoA) using WEB_CLIENT
    let res = await axios
      .post(
        'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json',
        {
          browseId: channelId,
          params: 'EgZ2aWRlb3PyBgQKAjoA',
          context: { client: WEB_CLIENT },
        },
        { headers: WEB_HEADERS, timeout: 8000 }
      )
      .catch(() => null);

    // Fallback without params if specific tab returns error
    if (!res || !res.data) {
      res = await axios.post(
        'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json',
        {
          browseId: channelId,
          context: { client: WEB_CLIENT },
        },
        { headers: WEB_HEADERS, timeout: 8000 }
      );
    }

    const data = res?.data;
    if (!data) return null;

    // 1. Channel Header
    const pageHeader = data.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
    const classicHeader = data.header?.c4TabbedHeaderRenderer || data.header?.pageHeaderRenderer || {};

    const title =
      pageHeader?.title?.dynamicTextViewModel?.text?.content ||
      classicHeader.title ||
      classicHeader.pageTitle?.runs?.[0]?.text ||
      classicHeader.pageTitle?.simpleText ||
      'YouTube Channel';

    const avatar =
      pageHeader?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.[0]?.url ||
      classicHeader.avatar?.thumbnails?.[classicHeader.avatar?.thumbnails?.length - 1]?.url ||
      undefined;

    const banner =
      pageHeader?.banner?.imageBannerViewModel?.image?.sources?.[0]?.url ||
      classicHeader.banner?.thumbnails?.[classicHeader.banner?.thumbnails?.length - 1]?.url ||
      undefined;

    const metaRows = pageHeader?.metadata?.contentMetadataViewModel?.metadataRows || [];
    let subscriberCount = classicHeader.subscriberCountText?.simpleText || '';
    let videosCount = classicHeader.videosCountText?.runs?.[0]?.text || '';

    for (const row of metaRows) {
      for (const part of row.metadataParts || []) {
        const text = part.text?.content || '';
        if (text.includes('subscriber')) subscriberCount = text;
        else if (text.includes('video')) videosCount = text;
      }
    }

    const description =
      pageHeader?.description?.content ||
      classicHeader.description?.simpleText ||
      '';

    // 2. Channel Videos & Playlists from Tabs
    const tabs =
      data.contents?.twoColumnBrowseResultsRenderer?.tabs ||
      data.contents?.singleColumnBrowseResultsRenderer?.tabs ||
      [];

    const videos: AppVideoItem[] = [];
    const playlists: ChannelPlaylistItem[] = [];
    let continuationToken: string | undefined;

    for (const tab of tabs) {
      const tabRenderer = tab.tabRenderer;
      const tabTitle = (tabRenderer?.title || '').toLowerCase();
      const content = tabRenderer?.content;

      // Extract Videos (from Videos or selected tab)
      if (tabRenderer?.selected || tabTitle.includes('video') || tabTitle.includes('home') || !tabTitle) {
        const richGrid = content?.richGridRenderer;
        const sections = content?.sectionListRenderer?.contents || [];

        // Check richGrid items
        if (richGrid?.contents) {
          for (const item of richGrid.contents) {
            if (item.continuationItemRenderer) {
              continuationToken =
                item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            } else {
              const v = extractVideoFromItem(item, title);
              if (v && !videos.some(ex => ex.id === v.id)) {
                videos.push(v);
              }
            }
          }
        }

        // Check sectionList items
        for (const sec of sections) {
          const items =
            sec?.itemSectionRenderer?.contents?.[0]?.gridRenderer?.items ||
            sec?.itemSectionRenderer?.contents ||
            [];

          for (const item of items) {
            if (item.continuationItemRenderer) {
              continuationToken =
                item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            } else {
              const v = extractVideoFromItem(item, title);
              if (v && !videos.some(ex => ex.id === v.id)) {
                videos.push(v);
              }
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

    // Fallback: If no videos returned in tabs, search by title
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
      videos,
      playlists: playlists.slice(0, 30),
      continuationToken,
    };
  } catch (err) {
    console.warn('[MediaServiceCore] Failed to fetch channel details:', err);
    return null;
  }
};

/**
 * 5. Fetch More Videos for Channel via Continuation Token (Infinite Scroll)
 */
export const fetchChannelMoreVideosDirect = async (
  continuationToken: string,
  channelTitle: string
): Promise<{ videos: AppVideoItem[]; nextContinuationToken?: string }> => {
  if (!continuationToken) return { videos: [] };

  try {
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json',
      {
        continuation: continuationToken,
        context: { client: WEB_CLIENT },
      },
      { headers: WEB_HEADERS, timeout: 8000 }
    );

    const actions = res.data?.onResponseReceivedActions || [];
    const continuationItems =
      actions[0]?.appendContinuationItemsAction?.continuationItems ||
      actions[0]?.reloadContinuationItemsCommand?.continuationItems ||
      [];

    const videos: AppVideoItem[] = [];
    let nextContinuationToken: string | undefined;

    for (const item of continuationItems) {
      if (item.continuationItemRenderer) {
        nextContinuationToken =
          item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      } else {
        const v = extractVideoFromItem(item, channelTitle);
        if (v && !videos.some(ex => ex.id === v.id)) {
          videos.push(v);
        }
      }
    }

    return { videos, nextContinuationToken };
  } catch (err) {
    console.warn('[MediaServiceCore] Failed to fetch more channel videos:', err);
    return { videos: [] };
  }
};
