import type { Place } from '../../data/types';
import { GPS_PLACE_ID, placeIdFor } from '../../data/types';
import { isSaved, removePlace, savePlace, selectPlace } from '../../state/places';
import type { PlacesState } from '../../state/places';
import { IconCheck, IconPin, IconStar, IconTrash } from './Icons';
import { LocateButton, PlaceSearch } from './PlaceSearch';
import { Sheet } from './Sheet';

export interface PlaceSheetProps {
  places: PlacesState;
  /** Display name of the current place (for the GPS place this comes from the forecast's nearest city). */
  currentName: string | null;
  onClose: () => void;
}

export function PlaceSheet({ places, currentName, onClose }: PlaceSheetProps) {
  const current = places.selected;
  const saved = isSaved(places, current);
  const pick = (place: Place) => {
    selectPlace(place);
    onClose();
  };

  return (
    <Sheet title="Places" onClose={onClose}>
      <section className="places-section" aria-label="Search">
        <PlaceSearch onPick={pick} />
      </section>

      <section className="places-section" aria-label="Current location">
        <LocateButton onDone={onClose} className="btn btn--block places-locate" />
        {places.gps ? (
          <p className="muted places-gps">
            {current?.id === GPS_PLACE_ID ? 'Showing' : 'Last location:'} {places.gps.name}
          </p>
        ) : null}
      </section>

      {current ? (
        <section className="places-section" aria-label="Save this place">
          <div className="place-current">
            <div className="place-current__text">
              <span className="place-current__label">Showing now</span>
              <strong>{currentName ?? current.name}</strong>
            </div>
            <button
              type="button"
              className={saved ? 'btn btn--star is-saved' : 'btn btn--star'}
              aria-pressed={saved}
              onClick={() => {
                if (saved) removePlace(current.kind === 'gps' ? placeIdFor(current.lat, current.lon) : current.id);
                else savePlace(current, currentName ?? undefined);
              }}
            >
              <IconStar size={18} filled={saved} />
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="places-section" aria-labelledby="saved-places-title">
        <h3 id="saved-places-title" className="sheet__section">
          Saved places
        </h3>
        {places.saved.length === 0 ? (
          <p className="muted">Star a place to keep it here for quick switching.</p>
        ) : (
          <ul className="place-list" role="list">
            {places.saved.map((p) => {
              const isCurrent = current?.id === p.id;
              return (
                <li key={p.id} className="place-list__item">
                  <button type="button" className="place-list__pick" onClick={() => pick(p)} aria-current={isCurrent ? 'true' : undefined}>
                    <IconPin size={18} />
                    <span>{p.name}</span>
                    {isCurrent ? <IconCheck size={18} className="place-list__check" /> : null}
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => removePlace(p.id)} aria-label={`Remove ${p.name}`}>
                    <IconTrash size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Sheet>
  );
}
