/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SKIES } from './sky';

/**
 * The "Feels like" pill is a 20 px label on rgba(255,255,255,0.2) laid over the hero gradient. The gradients
 * themselves give white text 5:1 or more (text.test.ts), but the lightened pill brings the label down to
 * 3.5-4.6:1 on the daytime skies, which is below the 4.5:1 that regular-weight 20 px text needs. Bold 20 px counts
 * as WCAG "large text" (3:1), so the label is bold; this pins that relationship down using the real CSS.
 */
const css = readFileSync(fileURLToPath(new URL('../../styles/app.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no ${selector} rule in app.css`);
  return match[1];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

describe('hero "Feels like" pill', () => {
  const pill = ruleBody('.hero__feels');
  const alpha = Number(/background:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(pill)?.[1]);
  const size = Number(/font-size:\s*([\d.]+)px/.exec(pill)?.[1]);
  const weight = Number(/font-weight:\s*(\d+)/.exec(ruleBody('.hero__feels-label'))?.[1] ?? 400);
  const large = size >= 24 || (size >= 18.66 && weight >= 700);

  it('reads its own CSS: a translucent white pill, a 20 px label', () => {
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.5);
    expect(size).toBe(20);
  });

  it('is bold enough to be large text, or else clears 4.5:1', () => {
    expect(large || weight >= 700).toBe(true);
  });

  it('keeps white on the pill at the required contrast over the lightest point of every sky', () => {
    const need = large ? 3 : 4.5;
    for (const [key, sky] of Object.entries(SKIES)) {
      // The pill sits about halfway down the hero; the bottom stop is the lightest it can ever be (conservative).
      const bottom = rgb(sky.bottom);
      const lightened = bottom.map((v) => v * (1 - alpha) + 255 * alpha) as [number, number, number];
      const ratio = 1.05 / (luminance(lightened) + 0.05);
      expect(ratio, `${key}: white on the pill over ${sky.bottom}`).toBeGreaterThanOrEqual(need);
    }
  });
});
