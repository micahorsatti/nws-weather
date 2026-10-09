import { describe, expect, it } from 'vitest';
import {
  describeIcon,
  describeWmo,
  iconFromNwsCode,
  iconFromNwsUrl,
  iconFromText,
  iconFromWmo,
  mostSignificant,
  parseNwsIconUrl,
  refineIconWithText,
  resolveIcon,
} from './icons';
import type { WxIcon } from './types';

const url = (path: string): string => `https://api.weather.gov/icons/land/${path}?size=medium`;

describe('NWS icon URLs', () => {
  it('parses day/night and one code', () => {
    expect(parseNwsIconUrl(url('day/few'))).toEqual({ isDaytime: true, codes: ['few'] });
    expect(parseNwsIconUrl(url('night/skc'))).toEqual({ isDaytime: false, codes: ['skc'] });
  });

  it('parses probability suffixes and two codes', () => {
    expect(parseNwsIconUrl(url('night/tsra_hi,40/ovc'))).toEqual({ isDaytime: false, codes: ['tsra_hi', 'ovc'] });
    expect(parseNwsIconUrl(url('day/rain,60/rain_showers,30'))).toEqual({ isDaytime: true, codes: ['rain', 'rain_showers'] });
    expect(parseNwsIconUrl('https://api.weather.gov/icons/land/day/sct.png')?.codes).toEqual(['sct']);
  });

  it('rejects things that are not icon URLs', () => {
    expect(parseNwsIconUrl(null)).toBeNull();
    expect(parseNwsIconUrl(undefined)).toBeNull();
    expect(parseNwsIconUrl('https://example.com/cloud.png')).toBeNull();
    expect(parseNwsIconUrl(42)).toBeNull();
  });

  it('maps every documented NWS code to a known icon', () => {
    const expected: Record<string, WxIcon> = {
      skc: 'clear',
      few: 'mostly-clear',
      sct: 'partly-cloudy',
      bkn: 'mostly-cloudy',
      ovc: 'cloudy',
      wind_skc: 'wind',
      wind_few: 'wind',
      wind_sct: 'wind',
      wind_bkn: 'wind',
      wind_ovc: 'wind',
      snow: 'snow',
      rain_snow: 'rain-snow',
      rain_sleet: 'sleet',
      snow_sleet: 'sleet',
      fzra: 'freezing-rain',
      rain_fzra: 'freezing-rain',
      snow_fzra: 'freezing-rain',
      sleet: 'sleet',
      rain: 'rain',
      rain_showers: 'rain-showers',
      rain_showers_hi: 'rain-showers',
      tsra: 'thunderstorm',
      tsra_sct: 'thunderstorm',
      tsra_hi: 'thunderstorm',
      tornado: 'tornado',
      hurricane: 'hurricane',
      tropical_storm: 'tropical-storm',
      dust: 'dust',
      smoke: 'smoke',
      haze: 'haze',
      hot: 'hot',
      cold: 'cold',
      blizzard: 'blizzard',
      fog: 'fog',
    };
    for (const [code, icon] of Object.entries(expected)) expect(iconFromNwsCode(code)).toBe(icon);
    expect(iconFromNwsCode('TSRA')).toBe('thunderstorm');
    expect(iconFromNwsCode('definitely_not_a_code')).toBe('unknown');
  });

  it('uses the more significant of two codes', () => {
    expect(iconFromNwsUrl(url('day/ovc/rain,60'))?.icon).toBe('rain');
    expect(iconFromNwsUrl(url('night/skc/tsra,30'))?.icon).toBe('thunderstorm');
    expect(iconFromNwsUrl(url('day/bkn/ovc'))?.icon).toBe('cloudy');
    expect(iconFromNwsUrl(url('day/snow/rain_fzra'))?.icon).toBe('freezing-rain');
    expect(iconFromNwsUrl(url('day/rain,40/tornado'))?.icon).toBe('tornado');
    expect(iconFromNwsUrl(url('day/fog/few'))?.icon).toBe('fog');
  });

  it('reports day/night alongside the icon, and null for unknown codes', () => {
    expect(iconFromNwsUrl(url('night/few'))).toEqual({ icon: 'mostly-clear', isDaytime: false });
    expect(iconFromNwsUrl(url('day/zzz'))).toBeNull();
  });

  it('ranks significance sensibly', () => {
    expect(mostSignificant(['clear', 'cloudy'])).toBe('cloudy');
    expect(mostSignificant(['rain', 'thunderstorm', 'cloudy'])).toBe('thunderstorm');
    expect(mostSignificant(['unknown'])).toBe('unknown');
    expect(mostSignificant([])).toBe('unknown');
  });
});

describe('WMO weather codes (Open-Meteo)', () => {
  it.each<[number, WxIcon]>([
    [0, 'clear'],
    [1, 'mostly-clear'],
    [2, 'partly-cloudy'],
    [3, 'cloudy'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'drizzle'],
    [53, 'drizzle'],
    [55, 'drizzle'],
    [56, 'freezing-rain'],
    [57, 'freezing-rain'],
    [61, 'rain'],
    [63, 'rain'],
    [65, 'heavy-rain'],
    [66, 'freezing-rain'],
    [67, 'freezing-rain'],
    [71, 'snow'],
    [73, 'snow'],
    [75, 'heavy-snow'],
    [77, 'snow'],
    [80, 'rain-showers'],
    [81, 'rain-showers'],
    [82, 'heavy-rain'],
    [85, 'snow-showers'],
    [86, 'snow-showers'],
    [95, 'thunderstorm'],
    [96, 'severe-thunderstorm'],
    [99, 'severe-thunderstorm'],
  ])('code %i -> %s', (code, icon) => {
    expect(iconFromWmo(code)).toBe(icon);
  });

  it('is unknown for codes outside the table or bad input', () => {
    expect(iconFromWmo(4)).toBe('unknown');
    expect(iconFromWmo(100)).toBe('unknown');
    expect(iconFromWmo(null)).toBe('unknown');
    expect(iconFromWmo(undefined)).toBe('unknown');
    expect(iconFromWmo(NaN)).toBe('unknown');
  });

  it('describes weather codes in NWS-style words', () => {
    expect(describeWmo(0)).toBe('Sunny');
    expect(describeWmo(0, false)).toBe('Clear');
    expect(describeWmo(3)).toBe('Cloudy');
    expect(describeWmo(61)).toBe('Light Rain');
    expect(describeWmo(95)).toBe('Thunderstorms');
    expect(describeWmo(null)).toBe('');
  });
});

describe('text matching (observations and short forecasts)', () => {
  it.each<[string, WxIcon]>([
    ['Sunny', 'clear'],
    ['Clear', 'clear'],
    ['Fair', 'clear'],
    ['Mostly Sunny', 'mostly-clear'],
    ['Mostly Clear', 'mostly-clear'],
    ['A Few Clouds', 'mostly-clear'],
    ['Partly Sunny', 'partly-cloudy'],
    ['Partly Cloudy', 'partly-cloudy'],
    ['Mostly Cloudy', 'mostly-cloudy'],
    ['Increasing Clouds', 'mostly-cloudy'],
    ['Cloudy', 'cloudy'],
    ['Overcast', 'cloudy'],
    ['Chance Showers And Thunderstorms', 'thunderstorm'],
    ['Severe Thunderstorms', 'severe-thunderstorm'],
    ['Slight Chance Light Rain', 'rain'],
    ['Rain Showers Likely', 'rain-showers'],
    ['Heavy Rain', 'heavy-rain'],
    ['Light Drizzle', 'drizzle'],
    ['Freezing Rain', 'freezing-rain'],
    ['Light Snow', 'snow'],
    ['Snow Showers', 'snow-showers'],
    ['Heavy Snow', 'heavy-snow'],
    ['Snow Flurries', 'snow-showers'],
    ['Wintry Mix', 'rain-snow'],
    ['Rain And Snow', 'rain-snow'],
    ['Sleet', 'sleet'],
    ['Blizzard', 'blizzard'],
    ['Patchy Fog', 'fog'],
    ['Areas Of Smoke', 'smoke'],
    ['Haze', 'haze'],
    ['Blowing Dust', 'dust'],
    ['Windy', 'wind'],
    ['Sunny and Breezy', 'clear'],
    ['Tornado Warning', 'tornado'],
    ['', 'unknown'],
    ['Gibberish', 'unknown'],
  ])('%j -> %s', (text, icon) => {
    expect(iconFromText(text)).toBe(icon);
  });

  it('handles non-strings', () => {
    expect(iconFromText(null)).toBe('unknown');
    expect(iconFromText(undefined)).toBe('unknown');
    expect(iconFromText(5)).toBe('unknown');
  });
});

describe('resolveIcon', () => {
  it('prefers the URL and sharpens it with the text', () => {
    expect(resolveIcon({ url: url('day/rain,80'), text: 'Heavy Rain' })).toEqual({ icon: 'heavy-rain', isDaytime: true });
    expect(resolveIcon({ url: url('night/snow'), text: 'Snow Showers' })).toEqual({ icon: 'snow-showers', isDaytime: false });
    expect(resolveIcon({ url: url('day/tsra'), text: 'Severe Thunderstorms' }).icon).toBe('severe-thunderstorm');
    expect(resolveIcon({ url: url('day/rain'), text: 'Light Drizzle' }).icon).toBe('drizzle');
    expect(resolveIcon({ url: url('day/rain'), text: 'Rain And Drizzle' }).icon).toBe('rain');
  });

  it('falls back to the text when the URL is missing (many stations report icon: null)', () => {
    expect(resolveIcon({ url: null, text: 'Mostly Cloudy' })).toEqual({ icon: 'mostly-cloudy', isDaytime: null });
    expect(resolveIcon({ url: undefined, text: undefined })).toEqual({ icon: 'unknown', isDaytime: null });
  });

  it('keeps day/night from a URL whose codes are unknown, and uses the text for the icon', () => {
    expect(resolveIcon({ url: url('night/zzz'), text: 'Clear' })).toEqual({ icon: 'clear', isDaytime: false });
  });

  it('refineIconWithText leaves other icons alone', () => {
    expect(refineIconWithText('clear', 'Heavy Rain')).toBe('clear');
    expect(refineIconWithText('rain', null)).toBe('rain');
  });
});

describe('describeIcon', () => {
  it('uses Sunny/Clear wording by time of day', () => {
    expect(describeIcon('clear', true)).toBe('Sunny');
    expect(describeIcon('clear', false)).toBe('Clear');
    expect(describeIcon('mostly-clear', true)).toBe('Mostly Sunny');
    expect(describeIcon('partly-cloudy', false)).toBe('Partly Cloudy');
    expect(describeIcon('thunderstorm')).toBe('Thunderstorms');
    expect(describeIcon('unknown')).toBe('');
  });
});
