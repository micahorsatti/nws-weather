/**
 * Read the time dimension out of a WMS GetCapabilities document. Pure string work (no DOMParser), so it
 * runs the same in the browser and in Vitest's node environment.
 */
import { parseTimeDimension, parseTimestamp } from './radarTime';

export interface ParsedCapabilities {
  /** Every advertised scan time, ascending epoch ms. */
  times: number[];
  /** The server's "default" (normally the newest scan), when given. */
  defaultTime: number | null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find the `time` dimension of a layer. WMS 1.3.0 uses <Dimension name="time">, WMS 1.1.1 uses
 * <Extent name="time">; both are accepted, with or without an XML namespace prefix.
 * Without a layerName, or when the name is not found, the first time dimension in the document is used.
 * Returns null when there is no usable time dimension (for example a ServiceException document).
 */
export function parseCapabilities(xml: string, layerName?: string): ParsedCapabilities | null {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');

  let from = 0;
  let until = text.length;
  if (layerName) {
    const nameRe = new RegExp(`<(?:\\w+:)?Name>\\s*${escapeRegExp(layerName)}\\s*</(?:\\w+:)?Name>`);
    const found = nameRe.exec(text);
    if (found) {
      from = found.index;
      // Stop at the next layer name so a layer without a time dimension cannot borrow its neighbor's.
      const next = text.slice(from + found[0].length).search(/<(?:\w+:)?Name>/);
      if (next >= 0) until = from + found[0].length + next;
    }
  }

  const dimRe = /<((?:\w+:)?(?:Dimension|Extent))\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const scope = text.slice(from, until);
  for (let m = dimRe.exec(scope); m; m = dimRe.exec(scope)) {
    const attrs = m[2] ?? '';
    if (attrs.trimEnd().endsWith('/')) {
      // A self-closing element has no content; the lazy match above ran on to some later closing tag.
      dimRe.lastIndex = m.index + 1;
      continue;
    }
    if (!/\bname\s*=\s*["']time["']/i.test(attrs)) continue;
    const times = parseTimeDimension(m[3] ?? '');
    const defaultAttr = /\bdefault\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    const defaultTime = defaultAttr ? parseTimestamp(defaultAttr) : null;
    if (times.length === 0 && defaultTime !== null) times.push(defaultTime);
    if (times.length === 0) return null;
    return { times, defaultTime };
  }
  return null;
}
