/**
 * NWS alert text is plain text with hard line breaks at ~65 columns. Reflow it into paragraphs
 * (never HTML): blank lines separate paragraphs, single newlines are just wrapping.
 * Paragraphs that start with the NWS "LABEL...text" convention (WHAT..., HAZARD..., IMPACT...) get the
 * label split out so the UI can emphasise it.
 */

export interface AlertParagraph {
  label: string | null;
  text: string;
}

const LABELLED = /^\*?\s*([A-Z][A-Z0-9 /&-]{1,30}?)\.\.\.\s*([\s\S]*)$/;

export function reflowAlertText(raw: string | null | undefined): AlertParagraph[] {
  if (!raw) return [];
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  // "* WHAT...x\n* WHERE...y" bullets without blank lines between them: split before each "* LABEL..."
  const blocks = normalized
    .split(/\n\s*\n/)
    .flatMap((block) => block.split(/\n(?=\*\s*[A-Z][A-Z0-9 /&-]{1,30}\.\.\.)/));

  const out: AlertParagraph[] = [];
  for (const block of blocks) {
    const text = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!text) continue;
    const m = LABELLED.exec(text);
    if (m) out.push({ label: m[1].trim(), text: m[2].trim() });
    else out.push({ label: null, text });
  }
  return out;
}
