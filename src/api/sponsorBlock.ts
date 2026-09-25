import axios from 'axios';

export interface SponsorSegment {
  category: string;
  actionType: string;
  segment: [number, number]; // [startSeconds, endSeconds]
  UUID?: string;
}

const SPONSOR_BLOCK_API = 'https://sponsor.ajay.app/api/skipSegments';

export const fetchSponsorSegments = async (videoId: string): Promise<SponsorSegment[]> => {
  if (!videoId) return [];
  try {
    const response = await axios.get<SponsorSegment[]>(
      `${SPONSOR_BLOCK_API}?videoID=${videoId}&categories=["sponsor","selfpromo","interaction","intro","outro","music_offtopic"]`,
      { timeout: 3500 }
    );
    return response.data || [];
  } catch {
    // Returns empty array if no segments exist or network fails
    return [];
  }
};

export const checkAndGetSkipPosition = (
  currentTimeSeconds: number,
  segments: SponsorSegment[]
): number | null => {
  for (const item of segments) {
    const [start, end] = item.segment;
    // If within segment boundary and not already at the end
    if (currentTimeSeconds >= start && currentTimeSeconds < end - 0.5) {
      return end;
    }
  }
  return null;
};
