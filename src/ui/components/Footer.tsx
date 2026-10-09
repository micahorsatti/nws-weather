import type { SourceProblem } from '../../data/types';
import { describeProblems } from '../lib/problems';
import { IconInfo } from './Icons';

export function Footer({ problems }: { problems: readonly SourceProblem[] }) {
  const summary = describeProblems(problems);
  return (
    <footer className="footer">
      {summary ? (
        <details className="footer__problems" data-testid="problems">
          <summary>
            <IconInfo size={16} />
            <span>{summary}</span>
          </summary>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.source}-${i}`}>
                <code>{p.source}</code> &mdash; {p.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p>
        Forecasts, alerts and observations: <strong>National Weather Service</strong>. Days 8&ndash;10 and UV: NOAA GFS model via Open-Meteo. Air quality: EPA
        AirNow and Open-Meteo Air Quality (Copernicus CAMS). Radar: NOAA MRMS. Maps: Esri, HERE, Garmin, &copy; OpenStreetMap contributors.
      </p>
      <p className="footer__fine">Unofficial app, not affiliated with NOAA or the National Weather Service. In an emergency, follow official alerts.</p>
    </footer>
  );
}
