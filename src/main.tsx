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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
