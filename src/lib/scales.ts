/**
 * Official category scales for AQI (US EPA) and UV index (WHO/EPA), with their standard colors.
 * The official colors are low-contrast against white text; use them for swatches, bars and dots,
 * and pick text color with `onColor`.
 */

export type AqiCategory = 'good' | 'moderate' | 'usg' | 'unhealthy' | 'very-unhealthy' | 'hazardous';

export const AQI_INFO: Record<AqiCategory, { label: string; color: string; onColor: string; advice: string }> = {
  good: { label: 'Good', color: '#00e400', onColor: '#0b2e0b', advice: 'Air quality is satisfactory.' },
  moderate: {
    label: 'Moderate',
    color: '#ffff00',
    onColor: '#3d3d00',
    advice: 'Unusually sensitive people should consider limiting prolonged outdoor exertion.',
  },
  usg: {
    label: 'Unhealthy for Sensitive Groups',
    color: '#ff7e00',
    onColor: '#3a1d00',
    advice: 'Sensitive groups should reduce prolonged or heavy outdoor exertion.',
  },
  unhealthy: {
    label: 'Unhealthy',
    color: '#ff0000',
    onColor: '#ffffff',
    advice: 'Everyone should reduce prolonged or heavy outdoor exertion.',
  },
  'very-unhealthy': {
    label: 'Very Unhealthy',
    color: '#8f3f97',
    onColor: '#ffffff',
    advice: 'Everyone should avoid prolonged or heavy outdoor exertion.',
  },
  hazardous: { label: 'Hazardous', color: '#7e0023', onColor: '#ffffff', advice: 'Everyone should avoid all outdoor exertion.' },
};

export function aqiCategory(aqi: number): AqiCategory {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'usg';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

/** EPA category number (1–6) to category. */
export function aqiCategoryFromNumber(n: number): AqiCategory | null {
  const order: AqiCategory[] = ['good', 'moderate', 'usg', 'unhealthy', 'very-unhealthy', 'hazardous'];
  return order[n - 1] ?? null;
}

export type UvCategory = 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';

export const UV_INFO: Record<UvCategory, { label: string; color: string; onColor: string; advice: string }> = {
  low: { label: 'Low', color: '#3ea72d', onColor: '#ffffff', advice: 'No protection needed for most people.' },
  moderate: { label: 'Moderate', color: '#fff300', onColor: '#3d3a00', advice: 'Wear sunscreen; seek shade around midday.' },
  high: { label: 'High', color: '#f18b00', onColor: '#3a2100', advice: 'Sunscreen, hat and sunglasses; reduce midday sun.' },
  'very-high': { label: 'Very High', color: '#e53210', onColor: '#ffffff', advice: 'Extra protection; avoid sun 10 a.m.–4 p.m.' },
  extreme: { label: 'Extreme', color: '#b567a4', onColor: '#ffffff', advice: 'Take all precautions; unprotected skin burns in minutes.' },
};

export function uvCategory(uv: number): UvCategory {
  const v = Math.round(uv);
  if (v <= 2) return 'low';
  if (v <= 5) return 'moderate';
  if (v <= 7) return 'high';
  if (v <= 10) return 'very-high';
  return 'extreme';
}
