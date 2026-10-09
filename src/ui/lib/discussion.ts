/**
 * Area Forecast Discussions are plain text hard-wrapped at ~68 columns, which looks ragged once it wraps
 * again on a phone. Reflow prose paragraphs, keep headings, and leave anything table-like verbatim.
 * The product also starts with teletype routing lines (WMO/AWIPS headers) that mean nothing to a reader:
 *
 *   000
 *   FXUS65 KPSR 090843
 *   AFDPSR
 *
 *   Area Forecast Discussion
 *   National Weather Service Phoenix AZ
 *   143 AM MST Fri Oct 9 2026
 */
export type DiscussionBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'pre'; text: string }
  | { kind: 'rule' };

const TITLE = /^\s*area forecast discussion\s*$/i;
const WMO_SEQUENCE = /^\d{3}$/; // "000"
const WMO_HEADING = /^[A-Z]{4}\d{2} [A-Z]{4} \d{6}(?: [A-Z]{3})?$/; // "FXUS65 KPSR 090843"
const AWIPS_ID = /^AFD[A-Z0-9]{3}$/; // "AFDPSR"
/** The routing header is a handful of lines; anything further down is not a header. */
const MAX_HEADER_LINES = 10;

/** Drop the routing header and leading blank lines so the text starts at "Area Forecast Discussion". */
export function stripAfdHeader(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const title = lines.findIndex((l) => TITLE.test(l));
  let start = 0;
  if (title >= 0 && title <= MAX_HEADER_LINES) {
    start = title;
  } else {
    // No recognisable title: still remove any routing lines at the very top.
    while (start < lines.length) {
      const l = lines[start].trim();
      if (l === '' || WMO_SEQUENCE.test(l) || WMO_HEADING.test(l) || AWIPS_ID.test(l)) start += 1;
      else break;
    }
  }
  return lines.slice(start).join('\n').trim();
}

const HEADING = /^\.[A-Z0-9][A-Z0-9 ()/,&'-]*\.\.\./;

function isProse(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines.every((line, i) => {
    if (/^\s{2,}/.test(line) || /\S {3,}\S/.test(line)) return false;
    return i === lines.length - 1 || line.length >= 40;
  });
}

export function parseDiscussion(raw: string): DiscussionBlock[] {
  const text = stripAfdHeader(raw);
  if (!text) return [];
  const out: DiscussionBlock[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let lines = block.split('\n').map((l) => l.replace(/\s+$/, ''));
    while (lines.length && lines[0] === '') lines.shift();
    if (lines.length === 0) continue;
    if (lines.length === 1 && (lines[0] === '&&' || lines[0] === '$$')) {
      out.push({ kind: 'rule' });
      continue;
    }
    if (HEADING.test(lines[0])) {
      out.push({ kind: 'heading', text: lines[0] });
      lines = lines.slice(1);
      if (lines.length === 0) continue;
    }
    if (isProse(lines)) out.push({ kind: 'para', text: lines.map((l) => l.trim()).join(' ') });
    else out.push({ kind: 'pre', text: lines.join('\n') });
  }
  return out;
}
