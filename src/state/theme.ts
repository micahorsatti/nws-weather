import { useEffect, useLayoutEffect, useState } from 'react';
import type { ThemePref } from './settings';

export type ResolvedTheme = 'light' | 'dark';

/** Page background per theme; keep in sync with --bg in styles/tokens.css (used for <meta name="theme-color">). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#eef2f8', dark: '#0f172a' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

function darkMedia(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return darkMedia()?.matches ?? false;
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark ? 'dark' : 'light';
}

/**
 * Stamp the resolved theme on <html data-theme> (always 'light' or 'dark', never 'system': the radar
 * view reads it), set native widget colors, and keep <meta name="theme-color"> in step.
 */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    m.content = THEME_COLORS[theme];
    document.head.appendChild(m);
  } else {
    // index.html ships a light and a dark tag keyed on prefers-color-scheme; an explicit choice must win.
    metas.forEach((m) => {
      m.content = THEME_COLORS[theme];
    });
  }
}

/** Resolve and apply the theme preference now (call once before first render to avoid a flash). */
export function initTheme(pref: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(pref, systemPrefersDark());
  applyTheme(resolved);
  return resolved;
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Keeps <html data-theme> in sync with the preference and, for 'system', with the OS setting. */
export function useTheme(pref: ThemePref): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = darkMedia();
    if (!mq) return;
    const onChange = () => setSystemDark(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolved = resolveTheme(pref, systemDark);
  useIsoLayoutEffect(() => {
    applyTheme(resolved);
  }, [resolved]);
  return resolved;
}
