import { File, Paths } from 'expo-file-system';

export interface DashFormatInfo {
  itag: number;
  qualityLabel?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  mimeType?: string;
  url: string;
  initRange?: { start: string | number; end: string | number };
  indexRange?: { start: string | number; end: string | number };
  audioTrackId?: string;
  audioTrackLabel?: string;
  audioLanguage?: string;
  isDefaultAudio?: boolean;
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&amp;/g, '&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a valid MPEG-DASH (MPD) XML Manifest compatible with ExoPlayer / Media3
 * Enables ExoPlayer to natively mux & sync High Quality Video (720p, 1080p, 1440p, 4K) with Multi-Language Audio
 */
export function buildDashMpdXml(
  durationSeconds: number,
  videoFormats: DashFormatInfo[],
  audioFormats: DashFormatInfo[]
): string {
  // Group video formats by mimeType (e.g., video/mp4 vs video/webm)
  const videoMimeGroups = new Map<string, DashFormatInfo[]>();
  for (const f of videoFormats) {
    if (!f.url || !f.initRange || !f.indexRange) continue;
    const mime = f.mimeType?.split(';')[0]?.trim() || 'video/mp4';
    if (!videoMimeGroups.has(mime)) {
      videoMimeGroups.set(mime, []);
    }
    videoMimeGroups.get(mime)!.push(f);
  }

  let videoAdaptationSets = '';
  let setIdx = 0;
  for (const [mime, formats] of videoMimeGroups) {
    let reps = '';
    for (const f of formats) {
      if (!f.url || !f.initRange || !f.indexRange) continue;
      const match = f.mimeType && f.mimeType.match(/codecs="([^"]+)"/);
      const defaultCodec = mime.includes('webm') ? 'vp9' : 'avc1.640028';
      const codecs = match ? match[1] : defaultCodec;
      const cleanUrl = f.url;
      const fpsAttr = f.fps ? ` frameRate="${f.fps}"` : '';
      const widthAttr = f.width ? ` width="${f.width}"` : '';
      const heightAttr = f.height ? ` height="${f.height}"` : '';
      reps += `      <Representation id="${f.itag}" bandwidth="${f.bitrate || 5000000}"${widthAttr}${heightAttr}${fpsAttr} codecs="${codecs}">\n`;
      reps += `        <BaseURL>${escapeXml(cleanUrl)}</BaseURL>\n`;
      reps += `        <SegmentBase indexRange="${f.indexRange.start}-${f.indexRange.end}">\n`;
      reps += `          <Initialization range="${f.initRange.start}-${f.initRange.end}"/>\n`;
      reps += `        </SegmentBase>\n`;
      reps += `      </Representation>\n`;
    }
    if (reps) {
      // subsegmentAlignment="false" allows independent queuing of video and audio subsegments without synthetic sync stalling
      videoAdaptationSets += `    <AdaptationSet id="${setIdx++}" contentType="video" mimeType="${mime}" subsegmentAlignment="false" subsegmentStartsWithSAP="1">\n`;
      videoAdaptationSets += `${reps}    </AdaptationSet>\n`;
    }
  }

  // Group audio formats by Audio Track / Language
  const audioTrackGroups = new Map<string, DashFormatInfo[]>();
  for (const f of audioFormats) {
    const key = f.audioTrackId || f.audioLanguage || 'default';
    if (!audioTrackGroups.has(key)) {
      audioTrackGroups.set(key, []);
    }
    audioTrackGroups.get(key)!.push(f);
  }

  const isVideoMp4 = videoFormats.some(v => v.mimeType?.includes('mp4'));

  let audioAdaptationSets = '';
  for (const [, formats] of audioTrackGroups) {
    const validAudios = formats.filter(f => f.url && f.initRange && f.indexRange);
    if (validAudios.length === 0) continue;

    const first = validAudios[0];
    const lang = escapeXml(first.audioLanguage || 'en');
    const label = escapeXml(first.audioTrackLabel || 'Original');
    const isDefault = first.isDefaultAudio ? 'true' : 'false';

    // Prioritize matching container audio (AAC audio/mp4 for MP4 videos, WebM Opus for WebM videos)
    const matchingMimeAudios = isVideoMp4
      ? validAudios.filter(a => a.mimeType?.includes('audio/mp4'))
      : validAudios.filter(a => a.mimeType?.includes('audio/webm'));
    const candidates = matchingMimeAudios.length > 0 ? matchingMimeAudios : validAudios;

    candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const chosenAudio = candidates[0];
    const mime = chosenAudio.mimeType?.split(';')[0]?.trim() || 'audio/mp4';
    const match = chosenAudio.mimeType && chosenAudio.mimeType.match(/codecs="([^"]+)"/);
    const defaultCodec = mime.includes('webm') ? 'opus' : 'mp4a.40.2';
    const codecs = match ? match[1] : defaultCodec;
    const cleanUrl = chosenAudio.url;

    const audioRep = `      <Representation id="${chosenAudio.itag}" bandwidth="${chosenAudio.bitrate || 128000}" codecs="${codecs}" startWithSAP="1">\n` +
      `        <BaseURL>${escapeXml(cleanUrl)}</BaseURL>\n` +
      `        <SegmentBase indexRange="${chosenAudio.indexRange!.start}-${chosenAudio.indexRange!.end}">\n` +
      `          <Initialization range="${chosenAudio.initRange!.start}-${chosenAudio.initRange!.end}"/>\n` +
      `        </SegmentBase>\n` +
      `      </Representation>\n`;

    audioAdaptationSets += `    <AdaptationSet id="${setIdx++}" contentType="audio" mimeType="${mime}" lang="${lang}" default="${isDefault}" subsegmentAlignment="false" subsegmentStartsWithSAP="1">\n`;
    audioAdaptationSets += `      <Label>${label}</Label>\n`;
    if (first.isDefaultAudio) {
      audioAdaptationSets += `      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>\n`;
    }
    audioAdaptationSets += `${audioRep}    </AdaptationSet>\n`;
  }

  const durationStr = Math.max(1, Math.floor(durationSeconds));
  const isWebmOnly = videoFormats.every(v => v.mimeType?.includes('webm')) && audioFormats.every(a => a.mimeType?.includes('webm'));
  const profileStr = isWebmOnly
    ? 'urn:webm:dash:profile:1080p:2012'
    : 'urn:mpeg:dash:profile:isoff-on-demand:2011';

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="${profileStr}"
     type="static"
     mediaPresentationDuration="PT${durationStr}S"
     minBufferTime="PT1.5S">
  <Period id="0" start="PT0S" duration="PT${durationStr}S">
${videoAdaptationSets}${audioAdaptationSets}  </Period>
</MPD>`;
}

/**
 * Creates a local .mpd manifest file on device storage and returns its file URI
 * When fed into ExoPlayer (expo-video), ExoPlayer plays 1080p / 4K with audio in perfect sync without black screens
 */
export async function createDashManifestFile(
  videoId: string,
  durationSeconds: number,
  videoFormats: DashFormatInfo[],
  audioFormats: DashFormatInfo[],
  selectedQualityLabel?: string,
  selectedAudioTrackId?: string
): Promise<string | null> {
  try {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      const fmtWithDur =
        videoFormats.find((f: any) => f.approxDurationMs) ||
        audioFormats.find((f: any) => f.approxDurationMs);
      if (fmtWithDur && (fmtWithDur as any).approxDurationMs) {
        durationSeconds = Math.floor(parseInt((fmtWithDur as any).approxDurationMs, 10) / 1000);
      }
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      durationSeconds = 600; // Safe default 10 minutes if duration cannot be extracted
    }

    let targetVideos = videoFormats;
    if (selectedQualityLabel && selectedQualityLabel !== 'Auto') {
      const qLower = selectedQualityLabel.toLowerCase().trim();

      // 1. Prioritize exact match (e.g., "1080p60" === "1080p60")
      let filtered = videoFormats.filter(
        v => (v.qualityLabel || '').toLowerCase().trim() === qLower
      );

      // 2. Fallback to prefix/substring only if exact match is not found
      if (filtered.length === 0) {
        filtered = videoFormats.filter(v => {
          const vLower = (v.qualityLabel || '').toLowerCase().trim();
          if (qLower.includes('4k') && vLower.includes('2160')) return true;
          if (qLower.includes('2160') && vLower.includes('4k')) return true;
          return vLower.startsWith(qLower) || qLower.startsWith(vLower);
        });
      }

      if (filtered.length > 0) {
        // 1. Prefer universal H.264 (avc1) for 1080p, 720p for 100% hardware compatibility
        const avcVideos = filtered.filter(v => v.mimeType?.includes('avc1'));
        // 2. For high-res (1440p, 4K), prefer hardware-accelerated VP9 (webm) over heavy AV1
        const vp9Videos = filtered.filter(
          v => v.mimeType?.includes('vp9') || v.mimeType?.includes('webm')
        );
        // 3. Fallback to mp4/av01 only if neither avc1 nor vp9 is present
        const mp4Videos = filtered.filter(v => v.mimeType?.includes('mp4'));
        const candidateList =
          avcVideos.length > 0
            ? avcVideos
            : vp9Videos.length > 0
            ? vp9Videos
            : mp4Videos.length > 0
            ? mp4Videos
            : filtered;

        // Select exactly ONE best video stream (highest bitrate) to prevent ABR switching stall
        candidateList.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        targetVideos = [candidateList[0]];
      }
    }

    let targetAudios = audioFormats;
    if (selectedAudioTrackId) {
      const matched = audioFormats.filter(
        a => a.audioTrackId === selectedAudioTrackId || a.audioLanguage === selectedAudioTrackId
      );
      if (matched.length > 0) {
        targetAudios = matched;
      }
    }

    if (targetVideos.length === 0 || targetAudios.length === 0) {
      return null;
    }

    const xml = buildDashMpdXml(durationSeconds, targetVideos, targetAudios);
    const cleanLabel = (selectedQualityLabel || 'auto').replace(/[^a-zA-Z0-9]/g, '_');
    const cleanTrack = (selectedAudioTrackId || 'all').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `dash_${videoId}_${cleanLabel}_${cleanTrack}.mpd`;

    // Use the new expo-file-system SDK 57 File + Paths API
    const mpdFile = new File(Paths.cache, fileName);
    mpdFile.write(xml);

    return mpdFile.uri;
  } catch (error) {
    console.warn('[DashManifestBuilder] Failed to create DASH manifest:', error);
    return null;
  }
}

