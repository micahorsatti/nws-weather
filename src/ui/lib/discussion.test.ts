import { describe, expect, it } from 'vitest';
import { parseDiscussion, stripAfdHeader } from './discussion';

// Shaped like a real product (from api.weather.gov): routing header, then the discussion proper.
const PHOENIX = [
  '',
  '000',
  'FXUS65 KPSR 090843',
  'AFDPSR',
  '',
  'Area Forecast Discussion',
  'National Weather Service Phoenix AZ',
  '143 AM MST Fri Oct 9 2026',
  '',
  '.UPDATE...',
  'Updated Aviation',
  '',
  '&&',
  '',
  '.KEY MESSAGES...',
  '',
  '- Dry conditions along with temperatures around 10 degrees above ',
  'normal will persist through Friday.',
  '',
  '- An Extreme Heat Warning remains in effect for portions of ',
  'southeast California and southwest Arizona through Friday.',
  '',
  '$$',
  '',
].join('\n');

describe('stripAfdHeader', () => {
  it('starts the text at "Area Forecast Discussion"', () => {
    const text = stripAfdHeader(PHOENIX);
    expect(text.startsWith('Area Forecast Discussion\nNational Weather Service Phoenix AZ')).toBe(true);
    expect(text).not.toMatch(/FXUS65|AFDPSR|^000/m);
  });

  it('trims leading blank lines and trailing whitespace', () => {
    expect(stripAfdHeader('\n\n\nArea Forecast Discussion\nNWS Topeka KS\n\n')).toBe('Area Forecast Discussion\nNWS Topeka KS');
  });

  it('handles Windows line endings', () => {
    expect(stripAfdHeader('000\r\nFXUS63 KTOP 082323\r\nAFDTOP\r\n\r\nArea Forecast Discussion\r\nbody')).toBe('Area Forecast Discussion\nbody');
  });

  it('still removes routing lines when the product title is missing', () => {
    expect(stripAfdHeader('\n000\nFXUS63 KTOP 082323 AAA\nAFDTOP\n\n.DISCUSSION...\nSomething happened.')).toBe('.DISCUSSION...\nSomething happened.');
  });

  it('leaves ordinary text alone', () => {
    expect(stripAfdHeader('Just some text\nwith lines')).toBe('Just some text\nwith lines');
  });

  it('does not cut real content when the title appears far down', () => {
    const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    expect(stripAfdHeader(`${body}\nArea Forecast Discussion\nmore`)).toContain('line 0');
  });
});

describe('parseDiscussion', () => {
  it('drops the header and reflows the bullet paragraphs', () => {
    const blocks = parseDiscussion(PHOENIX);
    expect(blocks[0]).toEqual({ kind: 'pre', text: 'Area Forecast Discussion\nNational Weather Service Phoenix AZ\n143 AM MST Fri Oct 9 2026' });
    expect(blocks.some((b) => b.kind === 'heading' && b.text === '.KEY MESSAGES...')).toBe(true);
    const para = blocks.find((b) => b.kind === 'para' && b.text.startsWith('- Dry conditions'));
    expect(para).toEqual({
      kind: 'para',
      text: '- Dry conditions along with temperatures around 10 degrees above normal will persist through Friday.',
    });
    expect(blocks[blocks.length - 1]).toEqual({ kind: 'rule' });
  });

  it('returns nothing for empty text', () => {
    expect(parseDiscussion('  \n ')).toEqual([]);
  });
});
