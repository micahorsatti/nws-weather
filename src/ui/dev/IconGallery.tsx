/** Development-only: every weather icon, day and night, on a card and on the hero sky. Open with ?gallery. */
import { skyFor } from '../lib/sky';
import { ALL_ICONS, ICON_LABELS, WxIcon } from '../components/WxIcon';

export default function IconGallery() {
  const sky = skyFor('clear', true);
  const night = skyFor('clear', false);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2 className="card__title">Weather icons</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 12 }}>
        {ALL_ICONS.map((icon) => (
          <div key={icon} style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{ICON_LABELS[icon]}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 6 }}>
                <WxIcon icon={icon} day size={56} />
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 6 }}>
                <WxIcon icon={icon} day={false} size={56} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="on-sky" style={{ background: `linear-gradient(${sky.top}, ${sky.bottom})`, borderRadius: 12, padding: 6 }}>
                <WxIcon icon={icon} day size={32} />
              </div>
              <div className="on-sky" style={{ background: `linear-gradient(${night.top}, ${night.bottom})`, borderRadius: 12, padding: 6 }}>
                <WxIcon icon={icon} day={false} size={32} />
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 6 }}>
                <WxIcon icon={icon} day size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
