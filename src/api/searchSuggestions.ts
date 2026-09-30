import axios from 'axios';
import { getHealthyPipedInstances } from './remoteConfig';

const suggestionsCache = new Map<string, string[]>();

/**
 * Fetch real-time YouTube search autocomplete predictions
 * Supports fast Google InnerTube suggestqueries with Piped failover
 */
export const fetchSearchSuggestions = async (query: string): Promise<string[]> => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || trimmed.length < 1) {
    return [];
  }

  // Check in-memory cache for fast keystroke retrieval
  if (suggestionsCache.has(trimmed)) {
    return suggestionsCache.get(trimmed) || [];
  }

  // Tier 1: Google YouTube SuggestQueries API (Ultra-fast, direct YouTube dataset)
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(
      trimmed
    )}`;

    const res = await axios.get(url, {
      timeout: 2500,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'application/json',
      },
    });

    if (Array.isArray(res.data) && Array.isArray(res.data[1])) {
      const suggestions: string[] = res.data[1].filter(
        (s: any) => typeof s === 'string' && s.trim().length > 0
      );

      if (suggestions.length > 0) {
        suggestionsCache.set(trimmed, suggestions);
        return suggestions.slice(0, 10);
      }
    }
  } catch {
    // Fallback to Tier 2
  }

  // Tier 2: Dynamic Piped Suggestions Failover
  try {
    const instances = getHealthyPipedInstances();
    for (const inst of instances.slice(0, 2)) {
      try {
        const pipedUrl = `${inst}/suggestions?query=${encodeURIComponent(trimmed)}`;
        const res = await axios.get(pipedUrl, { timeout: 2500 });
        if (Array.isArray(res.data) && res.data.length > 0) {
          const suggestions: string[] = res.data.filter(
            (s: any) => typeof s === 'string' && s.trim().length > 0
          );
          suggestionsCache.set(trimmed, suggestions);
          return suggestions.slice(0, 10);
        }
      } catch {
        // Try next instance
      }
    }
  } catch {
    // Both tiers failed
  }

  return [];
};
