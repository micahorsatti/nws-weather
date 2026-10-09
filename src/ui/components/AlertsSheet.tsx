import type { WeatherAlert } from '../../data/types';
import { reflowAlertText } from '../lib/alertText';
import { formatFull, parseTime } from '../lib/time';
import { SEVERITY_CLASS, untilText } from './AlertsBanner';
import { IconAlert, IconExternal } from './Icons';
import { Sheet } from './Sheet';

function Paragraphs({ text }: { text: string | null }) {
  const paragraphs = reflowAlertText(text);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="alert-item__p">
          {p.label ? <strong className="alert-item__label">{p.label}</strong> : null}
          {p.label ? ' ' : null}
          {p.text}
        </p>
      ))}
    </>
  );
}

function when(iso: string | null, tz: string): string | null {
  const ms = parseTime(iso);
  return ms === null ? null : formatFull(ms, tz);
}

export interface AlertsSheetProps {
  alerts: WeatherAlert[];
  now: number;
  tz: string;
  onClose: () => void;
}

export function AlertsSheet({ alerts, now, tz, onClose }: AlertsSheetProps) {
  return (
    <Sheet title={alerts.length === 1 ? 'Weather alert' : `Weather alerts (${alerts.length})`} onClose={onClose}>
      <ul className="alert-list" role="list">
        {alerts.map((a) => {
          const effective = when(a.effective ?? a.onset, tz);
          const expires = when(a.ends ?? a.expires, tz);
          const until = untilText(a, now, tz);
          const safeUrl = a.url && /^https:\/\//i.test(a.url) ? a.url : null;
          return (
            <li key={a.id} className="alert-item" data-testid="alert-item">
              <div className={`alert-item__head ${SEVERITY_CLASS[a.severity]}`}>
                <IconAlert size={20} />
                <h3 className="alert-item__event">{a.event}</h3>
                <span className="alert-item__sev">{a.severity === 'Unknown' ? 'Alert' : a.severity}</span>
              </div>
              {a.headline ? <p className="alert-item__headline">{a.headline}</p> : null}
              <dl className="alert-item__facts">
                {until ? (
                  <div>
                    <dt>Ends</dt>
                    <dd>{until.replace(/^until /, '')}</dd>
                  </div>
                ) : null}
                {effective ? (
                  <div>
                    <dt>Effective</dt>
                    <dd>{effective}</dd>
                  </div>
                ) : null}
                {expires ? (
                  <div>
                    <dt>Expires</dt>
                    <dd>{expires}</dd>
                  </div>
                ) : null}
                {a.areaDesc ? (
                  <div>
                    <dt>Area</dt>
                    <dd>{a.areaDesc}</dd>
                  </div>
                ) : null}
                {a.senderName ? (
                  <div>
                    <dt>Issued by</dt>
                    <dd>{a.senderName}</dd>
                  </div>
                ) : null}
              </dl>
              {a.description ? (
                <div className="alert-item__section">
                  <h4>What&rsquo;s happening</h4>
                  <Paragraphs text={a.description} />
                </div>
              ) : null}
              {a.instruction ? (
                <div className="alert-item__section alert-item__section--do">
                  <h4>What to do</h4>
                  <Paragraphs text={a.instruction} />
                </div>
              ) : null}
              {safeUrl ? (
                <a className="ext-link" href={safeUrl} target="_blank" rel="noopener noreferrer">
                  Official alert details <IconExternal size={16} />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
