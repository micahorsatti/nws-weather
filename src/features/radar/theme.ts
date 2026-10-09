/**
 * Which theme the radar view should use. The app stamps <html data-theme="light|dark"> with the resolved
 * theme (src/state/theme.ts); when that is missing (the harness, or first paint) the OS preference decides.
 */

export type Theme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The dataset value when it is 'light' or 'dark', otherwise the OS preference. */
export function resolveTheme(datasetValue: string | undefined | null, prefersDark: boolean): Theme {
  if (datasetValue === 'light' || datasetValue === 'dark') return datasetValue;
  return prefersDark ? 'dark' : 'light';
}

function prefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Read the current theme from the document. */
export function readTheme(): Theme {
  return resolveTheme(document.documentElement.dataset.theme, prefersDark());
}

/**
 * Call `onChange` whenever <html data-theme> changes or the OS preference flips.
 * Returns an unsubscribe function that tears down both listeners.
 */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let media: MediaQueryList | null = null;
  try {
    media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    media = null;
  }
  media?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', onChange);
  };
}
