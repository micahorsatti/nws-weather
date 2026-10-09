import type { Place } from '../../data/types';
import { selectPlace } from '../../state/places';
import { WxIcon } from './WxIcon';
import { LocateButton, PlaceSearch } from './PlaceSearch';

/** First run: no place has been chosen yet. */
export function Welcome() {
  return (
    <section className="card welcome" aria-labelledby="welcome-title" data-testid="welcome">
      <div className="welcome__art" aria-hidden="true">
        <WxIcon icon="partly-cloudy" size={84} />
      </div>
      <h2 id="welcome-title" className="welcome__title">
        Welcome to NWS Weather
      </h2>
      <p className="welcome__text">
        Hourly and 10-day forecasts, what it really <strong>feels like</strong>, rain, wind, UV, air quality, alerts and radar &mdash; straight from the National
        Weather Service.
      </p>
      <LocateButton />
      <div className="welcome__or" role="separator" aria-label="or">
        <span>or</span>
      </div>
      <PlaceSearch onPick={(p: Place) => selectPlace(p)} />
      <p className="welcome__fine">Forecasts cover the United States and its territories.</p>
    </section>
  );
}
