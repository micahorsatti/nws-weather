import type { DataSource, SourceProblem } from '../../data/types';

/** What each data source means to a person, in the order we list them. */
const SOURCE_WORDS: Record<DataSource, { group: string }> = {
  'nws-points': { group: 'location details' },
  'nws-forecast': { group: 'the 7-day forecast' },
  'nws-hourly': { group: 'the hourly forecast' },
  'nws-grid': { group: 'some forecast details' },
  'nws-observation': { group: 'current observations' },
  'nws-alerts': { group: 'weather alerts' },
  'open-meteo-gfs': { group: 'the extended outlook' },
  'open-meteo-uv': { group: 'UV' },
  'open-meteo-aqi': { group: 'air quality' },
  airnow: { group: 'official AirNow readings' },
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}

/**
 * "UV and air quality temporarily unavailable". Open-Meteo AQI and AirNow failures are folded into one
 * "air quality" mention. Returns null when nothing is wrong.
 */
export function describeProblems(problems: readonly SourceProblem[]): string | null {
  if (problems.length === 0) return null;
  const groups: string[] = [];
  for (const p of problems) {
    const g = SOURCE_WORDS[p.source]?.group ?? 'some data';
    const merged = g === 'official AirNow readings' ? 'air quality' : g;
    if (!groups.includes(merged)) groups.push(merged);
  }
  const text = joinWords(groups);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} temporarily unavailable`;
}
