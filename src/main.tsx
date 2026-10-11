import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { settingsStore } from './state/settings';
import { initTheme } from './state/theme';
import './styles/tokens.css';
import './styles/global.css';
import './styles/app.css';
import './styles/hourly.css';
import './styles/sheets.css';

// Stamp <html data-theme> before the first paint so there is no light/dark flash.
initTheme(settingsStore.get().theme);

// Ask the browser not to evict our cached forecasts under storage pressure.
void navigator.storage?.persist?.().catch(() => {});

// A deploy's new service worker takes over open pages (registerType 'autoUpdate'), and the old build's
// lazy chunks (the radar) are gone from the server and the cache. Move onto the new build, but only
// while the page is hidden, so it never reloads under the user's finger.
const sw = navigator.serviceWorker;
if (sw) {
  let hadController = sw.controller !== null;
  sw.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true; // first install: this page already runs the current build
      return;
    }
    if (document.visibilityState === 'hidden') window.location.reload();
    else document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && window.location.reload());
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
