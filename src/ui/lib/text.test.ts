import { describe, expect, it } from 'vitest';
import { reflowAlertText } from './alertText';
import { describeProblems } from './problems';
import { SKIES, skyFor, skyKey } from './sky';
import { clamp, dewPointComfort, precipShort, snowShort } from './format';
import { heatColor, heatGradient } from './heat';
import { ALL_ICONS } from '../components/WxIcon';

describe('reflowAlertText (NWS alert text is plain text with hard line breaks)', () => {
  it('joins hard-wrapped lines into paragraphs and keeps paragraph breaks', () => {
    const raw = 'At 831 PM CDT, a severe thunderstorm was located\n6 miles south of Linn, moving northeast at 35\nmph.\n\nSecond paragraph here.';
    expect(reflowAlertText(raw)).toEqual([
      { label: null, text: 'At 831 PM CDT, a severe thunderstorm was located 6 miles south of Linn, moving northeast at 35 mph.' },
      { label: null, text: 'Second paragraph here.' },
    ]);
  });

  it('splits out the NWS "LABEL...text" convention', () => {
    expect(reflowAlertText('HAZARD...70 mph wind gusts and quarter\nsize hail.\n\nSOURCE...Radar indicated.')).toEqual([
      { label: 'HAZARD', text: '70 mph wind gusts and quarter size hail.' },
      { label: 'SOURCE', text: 'Radar indicated.' },
    ]);
  });

  it('handles "* WHAT..." bullets, even without blank lines between them', () => {
    const raw = '* WHAT...Flash flooding is possible.\n* WHERE...Portions of north central\n  Kansas.\n* WHEN...Until Friday morning.';
    expect(reflowAlertText(raw)).toEqual([
      { label: 'WHAT', text: 'Flash flooding is possible.' },
      { label: 'WHERE', text: 'Portions of north central Kansas.' },
      { label: 'WHEN', text: 'Until Friday morning.' },
    ]);
  });

  it('leaves mixed-case "Locations impacted include..." as ordinary text', () => {
    const out = reflowAlertText('Locations impacted include...\nLinn, Greenleaf and Hanover.');
    expect(out).toEqual([{ label: null, text: 'Locations impacted include... Linn, Greenleaf and Hanover.' }]);
  });

  it('returns plain text only (markup is not interpreted)', () => {
    const out = reflowAlertText('<b>Bold</b> & <script>alert(1)</script>');
    expect(out[0].text).toBe('<b>Bold</b> & <script>alert(1)</script>');
  });

  it('copes with Windows line endings, blanks and nothing', () => {
    expect(reflowAlertText('a\r\nb\r\n\r\nc')).toEqual([
      { label: null, text: 'a b' },
      { label: null, text: 'c' },
    ]);
    expect(reflowAlertText(null)).toEqual([]);
    expect(reflowAlertText('  \n  ')).toEqual([]);
  });
});

describe('describeProblems', () => {
  it('summarises partial failures in plain words', () => {
    expect(describeProblems([])).toBeNull();
    expect(describeProblems([{ source: 'open-meteo-uv', message: 'x' }, { source: 'open-meteo-aqi', message: 'y' }])).toBe('UV and air quality temporarily unavailable');
    expect(describeProblems([{ source: 'airnow', message: 'x' }, { source: 'open-meteo-aqi', message: 'y' }])).toBe('Air quality temporarily unavailable');
    expect(describeProblems([{ source: 'nws-alerts', message: 'x' }, { source: 'open-meteo-gfs', message: 'y' }, { source: 'open-meteo-uv', message: 'z' }])).toBe(
      'Weather alerts, the extended outlook, and UV temporarily unavailable',
    );
  });
});

/** WCAG relative luminance contrast of white text on a #rrggbb background. */
function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return 1.05 / (lum + 0.05);
}

describe('hero sky gradients', () => {
  it('keeps white text above 4.5:1 on both ends of every gradient', () => {
    for (const [key, sky] of Object.entries(SKIES)) {
      expect(contrastWithWhite(sky.top), `${key} top`).toBeGreaterThanOrEqual(4.5);
      expect(contrastWithWhite(sky.bottom), `${key} bottom`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has a sky for every weather icon, day and night', () => {
    for (const icon of ALL_ICONS) {
      for (const day of [true, false]) {
        const sky = skyFor(icon, day);
        expect(SKIES[sky.key]).toBeDefined();
      }
    }
  });

  it('picks sensible skies', () => {
    expect(skyKey('clear', true)).toBe('clear-day');
    expect(skyKey('clear', false)).toBe('clear-night');
    expect(skyKey('thunderstorm', true)).toBe('storm');
    expect(skyKey('heavy-snow', false)).toBe('snow-night');
    expect(skyKey('rain', true)).toBe('rain-day');
    expect(skyKey('unknown', false)).toBe('cloudy-night');
  });
});

describe('format helpers', () => {
  it('writes compact precipitation amounts for chart cells', () => {
    expect(precipShort(0.3, 'imperial')).toBe('.01');
    expect(precipShort(0.01, 'imperial')).toBe('<.01');
    expect(precipShort(3.2, 'imperial')).toBe('.13');
    expect(precipShort(30, 'imperial')).toBe('1.2');
    expect(precipShort(3.24, 'metric')).toBe('3.2');
    expect(precipShort(14.7, 'metric')).toBe('15');
    expect(precipShort(0.04, 'metric')).toBe('<0.1');
    expect(precipShort(null, 'metric')).toBe('');
    expect(snowShort(25.4, 'imperial')).toBe('1.0');
    expect(snowShort(25, 'metric')).toBe('2.5');
  });

  it('describes mugginess by dew point', () => {
    expect(dewPointComfort(5)?.label).toBe('Dry'); // 41°F
    expect(dewPointComfort(15)?.label).toBe('Comfortable'); // 59°F
    expect(dewPointComfort(18)?.label).toBe('Slightly humid'); // 64°F
    expect(dewPointComfort(21)?.label).toBe('Muggy'); // 70°F -> boundary rounds up to the next band
    expect(dewPointComfort(23.3)?.label).toBe('Very humid'); // 74°F
    expect(dewPointComfort(26)?.label).toBe('Oppressive');
    expect(dewPointComfort(null)).toBeNull();
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
});

describe('temperature colors for the range bars', () => {
  it('runs from cold blue-violet through green to hot red and is always a valid color', () => {
    expect(heatColor(-30)).toBe(heatColor(-25));
    expect(heatColor(-5)).not.toBe(heatColor(35));
    for (const c of [-40, -10, 0, 10, 20, 30, 40, 50]) expect(heatColor(c)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
  });

  it('builds a left-to-right gradient for a range, or a flat color for a point', () => {
    expect(heatGradient(5, 35)).toMatch(/^linear-gradient\(90deg, rgb/);
    expect(heatGradient(35, 5)).toBe(heatGradient(5, 35));
    expect(heatGradient(20, 20)).toMatch(/^rgb\(/);
  });
});
