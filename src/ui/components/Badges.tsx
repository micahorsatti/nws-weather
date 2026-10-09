import { AQI_INFO, UV_INFO, aqiCategory, aqiCategoryFromNumber, uvCategory } from '../../lib/scales';
import type { AqiCategory } from '../../lib/scales';

/**
 * Category chips: the number sits on the official category color (text color chosen for contrast), and the
 * category name always appears next to it in words, so meaning never relies on color alone.
 */
export function AqiBadge({ aqi, category, label = true, className }: { aqi: number | null; category?: AqiCategory | null; label?: boolean; className?: string }) {
  const cat: AqiCategory | null = aqi !== null ? aqiCategory(aqi) : category ?? null;
  if (!cat) return null;
  const info = AQI_INFO[cat];
  return (
    <span className={className ? `badge ${className}` : 'badge'}>
      {aqi !== null ? (
        <span className="badge__chip num" style={{ background: info.color, color: info.onColor }}>
          {Math.round(aqi)}
        </span>
      ) : (
        <span className="badge__chip badge__chip--swatch" style={{ background: info.color }} aria-hidden="true" />
      )}
      {label ? <span className="badge__label">{info.label}</span> : null}
    </span>
  );
}

export function UvBadge({ uv, label = true, className }: { uv: number; label?: boolean; className?: string }) {
  const info = UV_INFO[uvCategory(uv)];
  return (
    <span className={className ? `badge ${className}` : 'badge'}>
      <span className="badge__chip num" style={{ background: info.color, color: info.onColor }}>
        {Math.round(uv)}
      </span>
      {label ? <span className="badge__label">{info.label}</span> : null}
    </span>
  );
}

export { aqiCategoryFromNumber };
