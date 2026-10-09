import { useId, useState } from 'react';
import type { Settings, ThemePref } from '../../state/settings';
import type { UnitSystem } from '../../lib/units';
import { IconCheck, IconExternal } from './Icons';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';

export const AIRNOW_KEY_URL = 'https://docs.airnowapi.org/account/request/';

export interface SettingsSheetProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClearCache: () => Promise<void> | void;
  onClose: () => void;
}

export function SettingsSheet({ settings, onChange, onClearCache, onClose }: SettingsSheetProps) {
  const keyId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(settings.airNowKey);
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState<'idle' | 'busy' | 'done'>('idle');

  const trimmed = draft.replace(/\s+/g, '');
  const dirty = trimmed !== settings.airNowKey;
  const looksOff = trimmed.length > 0 && !/^[A-Za-z0-9-]{20,}$/.test(trimmed);

  const saveKey = () => {
    onChange({ airNowKey: trimmed });
    setDraft(trimmed);
    setSaved(true);
  };

  return (
    <Sheet title="Settings" onClose={onClose}>
      <section className="setting" aria-labelledby={`${keyId}-units`}>
        <h3 id={`${keyId}-units`} className="setting__label">
          Units
        </h3>
        <Segmented<UnitSystem>
          label="Units"
          value={settings.units}
          onChange={(units) => onChange({ units })}
          options={[
            { value: 'imperial', label: <span className="seg__two"><strong>Imperial</strong><small>°F · mph · in</small></span>, ariaLabel: 'Imperial: degrees Fahrenheit, miles per hour, inches' },
            { value: 'metric', label: <span className="seg__two"><strong>Metric</strong><small>°C · km/h · mm</small></span>, ariaLabel: 'Metric: degrees Celsius, kilometres per hour, millimetres' },
          ]}
        />
      </section>

      <section className="setting" aria-labelledby={`${keyId}-theme`}>
        <h3 id={`${keyId}-theme`} className="setting__label">
          Appearance
        </h3>
        <Segmented<ThemePref>
          label="Appearance"
          value={settings.theme}
          onChange={(theme) => onChange({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </section>

      <section className="setting" aria-labelledby={`${keyId}-air`}>
        <h3 id={`${keyId}-air`} className="setting__label">
          Air quality
        </h3>
        <p className="setting__help">
          Without a key, air quality is a computer-model estimate. A free AirNow key adds the EPA&rsquo;s official readings and forecasts.{' '}
          <a href={AIRNOW_KEY_URL} target="_blank" rel="noopener noreferrer">
            Get a free key <IconExternal size={14} className="inline-icon" />
          </a>
        </p>
        <label htmlFor={keyId} className="field__label">
          AirNow API key
        </label>
        <div className="field">
          <input
            id={keyId}
            className="field__input"
            type={reveal ? 'text' : 'password'}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby={hintId}
            placeholder="Paste your key"
          />
          <button type="button" className="btn btn--quiet" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
        <p id={hintId} className="setting__help">
          Stored only on this device and sent only to AirNow.
        </p>
        {looksOff ? <p className="setting__warn">That doesn&rsquo;t look like an AirNow key. They&rsquo;re about 36 letters, numbers and dashes.</p> : null}
        <div className="setting__actions">
          <button type="button" className="btn btn--primary" onClick={saveKey} disabled={!dirty}>
            Save key
          </button>
          {settings.airNowKey ? (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setDraft('');
                onChange({ airNowKey: '' });
                setSaved(false);
              }}
            >
              Remove key
            </button>
          ) : null}
          {saved && !dirty ? (
            <span className="setting__ok" role="status">
              <IconCheck size={16} /> {settings.airNowKey ? 'Key saved' : 'Key removed'}
            </span>
          ) : null}
        </div>
      </section>

      <section className="setting" aria-labelledby={`${keyId}-data`}>
        <h3 id={`${keyId}-data`} className="setting__label">
          Stored data
        </h3>
        <p className="setting__help">Forecasts are saved on this device so the app opens instantly and works offline. Clearing them is safe; your places and settings stay.</p>
        <div className="setting__actions">
          <button
            type="button"
            className="btn"
            disabled={cleared === 'busy'}
            onClick={async () => {
              setCleared('busy');
              try {
                await onClearCache();
              } finally {
                setCleared('done');
              }
            }}
          >
            Clear cached data
          </button>
          {cleared === 'done' ? (
            <span className="setting__ok" role="status">
              <IconCheck size={16} /> Cleared
            </span>
          ) : null}
        </div>
      </section>

      <section className="setting" aria-labelledby={`${keyId}-about`}>
        <h3 id={`${keyId}-about`} className="setting__label">
          About
        </h3>
        <p className="setting__help">
          NWS Weather presents National Weather Service data in a friendlier way. It&rsquo;s an unofficial app and isn&rsquo;t affiliated with NOAA or the National
          Weather Service. In an emergency, follow official alerts.
        </p>
        <ul className="credits" role="list">
          <li>
            <strong>Forecasts, alerts, observations, forecaster text:</strong> National Weather Service (api.weather.gov)
          </li>
          <li>
            <strong>Days 8&ndash;10 and UV:</strong> NOAA GFS model via{' '}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
              Open-Meteo
            </a>{' '}
            (CC BY 4.0)
          </li>
          <li>
            <strong>Air quality:</strong> EPA AirNow; Open-Meteo Air Quality (Copernicus CAMS)
          </li>
          <li>
            <strong>Radar:</strong> NOAA / NWS MRMS
          </li>
          <li>
            <strong>Maps:</strong> Esri, HERE, Garmin, &copy; OpenStreetMap contributors
          </li>
          <li>
            <strong>Sunrise &amp; sunset:</strong> calculated on your device
          </li>
        </ul>
      </section>
    </Sheet>
  );
}
