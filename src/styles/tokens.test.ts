/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Read the file itself: Vitest replaces CSS imports (even ?raw ones) with an empty module. It may be checked out
// with CRLF line endings.
const tokens = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/**
 * The design tokens' text colors on the surfaces they sit on. The hero sky gradients and the AQI/UV chips are
 * checked where their colors are defined (sky.test.ts, scales.test.ts); this covers the cards, sheets and
 * controls, in both themes. WCAG AA: 4.5:1 for normal text.
 */

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const open = css.indexOf('{', start);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(open + 1, i - 1);
}

function hexVars(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const THEMES: Array<[string, Record<string, string>]> = [
  ['light', hexVars(block(tokens, ":root,\n:root[data-theme='light']"))],
  ['dark', hexVars(block(tokens, ":root[data-theme='dark']"))],
  // The first-paint copy of the dark theme (before data-theme is stamped) must not drift from the real one.
  ['dark (first paint, prefers-color-scheme)', hexVars(block(tokens, '@media (prefers-color-scheme: dark)'))],
];

const TEXT = ['ink', 'ink-2', 'ink-3', 'accent', 'danger', 'ok'] as const;
const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3', 'seg-track'] as const;

describe('design tokens: text on surfaces', () => {
  it.each(THEMES)('%s theme: every text token reads on every surface (>= 4.5:1)', (_name, vars) => {
    const failures: string[] = [];
    for (const fg of TEXT) {
      for (const bg of SURFACES) {
        expect(vars[fg], `--${fg} is defined`).toBeDefined();
        expect(vars[bg], `--${bg} is defined`).toBeDefined();
        const ratio = contrast(vars[fg], vars[bg]);
        if (ratio < 4.5) failures.push(`--${fg} ${vars[fg]} on --${bg} ${vars[bg]} = ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the first-paint dark tokens match the dark theme', () => {
    const [, dark] = THEMES[1];
    const [, firstPaint] = THEMES[2];
    for (const name of [...TEXT, ...SURFACES]) expect(firstPaint[name], `--${name}`).toBe(dark[name]);
  });
});
