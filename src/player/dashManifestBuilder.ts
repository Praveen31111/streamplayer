import { File, Paths } from 'expo-file-system';

export interface DashFormatInfo {
  itag: number;
  qualityLabel?: string;
  width?: number;
  height?: number;
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
  return String(unsafe)
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
  let videoReps = '';
  for (const f of videoFormats) {
    if (!f.url || !f.initRange || !f.indexRange) continue;
    const match = f.mimeType && f.mimeType.match(/codecs="([^"]+)"/);
    const codecs = match ? match[1] : 'avc1.640028';
    videoReps += `      <Representation id="${f.itag}" bandwidth="${f.bitrate || 1000000}" width="${f.width || 1280}" height="${f.height || 720}" codecs="${codecs}">\n`;
    videoReps += `        <BaseURL>${escapeXml(f.url)}</BaseURL>\n`;
    videoReps += `        <SegmentBase indexRange="${f.indexRange.start}-${f.indexRange.end}">\n`;
    videoReps += `          <Initialization range="${f.initRange.start}-${f.initRange.end}"/>\n`;
    videoReps += `        </SegmentBase>\n`;
    videoReps += `      </Representation>\n`;
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

  let audioAdaptationSets = '';
  let adaptId = 1;
  for (const [, formats] of audioTrackGroups) {
    const first = formats[0];
    const lang = escapeXml(first.audioLanguage || 'en');
    const label = escapeXml(first.audioTrackLabel || 'Original');
    const isDefault = first.isDefaultAudio ? 'true' : 'false';

    let audioReps = '';
    for (const f of formats) {
      if (!f.url || !f.initRange || !f.indexRange) continue;
      const match = f.mimeType && f.mimeType.match(/codecs="([^"]+)"/);
      const codecs = match ? match[1] : 'mp4a.40.2';
      audioReps += `      <Representation id="${f.itag}" bandwidth="${f.bitrate || 128000}" codecs="${codecs}">\n`;
      audioReps += `        <BaseURL>${escapeXml(f.url)}</BaseURL>\n`;
      audioReps += `        <SegmentBase indexRange="${f.indexRange.start}-${f.indexRange.end}">\n`;
      audioReps += `          <Initialization range="${f.initRange.start}-${f.initRange.end}"/>\n`;
      audioReps += `        </SegmentBase>\n`;
      audioReps += `      </Representation>\n`;
    }

    if (audioReps) {
      audioAdaptationSets += `    <AdaptationSet id="${adaptId++}" mimeType="audio/mp4" lang="${lang}" default="${isDefault}" subsegmentAlignment="true" subsegmentStartsWithSAP="1">\n`;
      audioAdaptationSets += `      <Label>${label}</Label>\n`;
      if (first.isDefaultAudio) {
        audioAdaptationSets += `      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>\n`;
      }
      audioAdaptationSets += `${audioReps}    </AdaptationSet>\n`;
    }
  }

  const durationStr = Math.max(1, Math.floor(durationSeconds));

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT${durationStr}S"
     minBufferTime="PT1.5S">
  <Period>
    <AdaptationSet id="0" mimeType="video/mp4" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
${videoReps}    </AdaptationSet>
${audioAdaptationSets}  </Period>
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
      return null;
    }

    let targetVideos = videoFormats;
    if (selectedQualityLabel && selectedQualityLabel !== 'Auto') {
      const filtered = videoFormats.filter(
        v => v.qualityLabel?.toLowerCase() === selectedQualityLabel.toLowerCase()
      );
      if (filtered.length > 0) {
        targetVideos = filtered;
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

