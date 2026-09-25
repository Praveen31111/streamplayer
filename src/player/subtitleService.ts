import axios from 'axios';

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

// In-memory cache for fetched subtitle tracks by URL
const subtitleCache = new Map<string, SubtitleCue[]>();

/**
 * Fetches and parses timed text subtitles from YouTube InnerTube's caption URL.
 * Requests fmt=json3 which is standard and compact across all platforms.
 */
export async function fetchSubtitleCues(baseUrl: string): Promise<SubtitleCue[]> {
  if (!baseUrl) return [];

  if (subtitleCache.has(baseUrl)) {
    return subtitleCache.get(baseUrl)!;
  }

  try {
    const separator = baseUrl.includes('?') ? '&' : '?';
    // Append fmt=json3 to receive cleanly parsed structured event timings
    const targetUrl = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}${separator}fmt=json3`;

    const res = await axios.get(targetUrl, {
      timeout: 6000,
      headers: {
        'Accept': 'application/json, text/plain, */*',
      },
    });

    const data = res.data;
    const cues: SubtitleCue[] = [];

    if (data && Array.isArray(data.events)) {
      for (const event of data.events) {
        if (!event.segs || !event.tStartMs) continue;

        const text = event.segs
          .map((s: any) => s.utf8 || '')
          .join('')
          .replace(/\n/g, ' ')
          .trim();

        if (!text) continue;

        const startMs = event.tStartMs;
        const durationMs = event.dDurationMs || 2500;
        const endMs = startMs + durationMs;

        cues.push({
          startMs,
          endMs,
          text,
        });
      }
    } else if (typeof data === 'string') {
      // Fallback: simple XML / timed-text parser for classic format
      const xmlRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
      let match;
      while ((match = xmlRegex.exec(data)) !== null) {
        const startSec = parseFloat(match[1]);
        const durSec = match[2] ? parseFloat(match[2]) : 2.5;
        const rawText = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, '')
          .trim();

        if (rawText) {
          cues.push({
            startMs: Math.floor(startSec * 1000),
            endMs: Math.floor((startSec + durSec) * 1000),
            text: rawText,
          });
        }
      }
    }

    // Sort by startMs
    cues.sort((a, b) => a.startMs - b.startMs);
    subtitleCache.set(baseUrl, cues);
    return cues;
  } catch (error) {
    console.warn('[SubtitleService] Failed to load subtitles:', error);
    return [];
  }
}

/**
 * Returns the currently active subtitle string at currentTimeMs, or null if none
 */
export function getCurrentSubtitleText(cues: SubtitleCue[], currentTimeMs: number): string | null {
  if (!cues || cues.length === 0) return null;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (currentTimeMs >= cue.startMs && currentTimeMs <= cue.endMs) {
      return cue.text;
    }
  }
  return null;
}
