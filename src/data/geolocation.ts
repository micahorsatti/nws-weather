/** Device location via the browser Geolocation API, with friendly rejection messages. */

export interface DevicePosition {
  lat: number;
  lon: number;
  accuracyM: number;
}

const GEO_PERMISSION_DENIED = 1;
const GEO_POSITION_UNAVAILABLE = 2;
const GEO_TIMEOUT = 3;

/** Human-friendly message for a GeolocationPositionError code. */
export function geolocationMessage(code: number): string {
  switch (code) {
    case GEO_PERMISSION_DENIED:
      return 'Location access was blocked. Allow location for this site in your browser settings, or search for a place instead.';
    case GEO_POSITION_UNAVAILABLE:
      return "Your device couldn't work out where you are. Check that location services are on, or search for a place instead.";
    case GEO_TIMEOUT:
      return 'Finding your location took too long. Try again, or search for a place instead.';
    default:
      return "Couldn't get your location. Search for a place instead.";
  }
}

/** Current position (a recent fix up to 5 minutes old is fine; accuracy within a few km is plenty for weather). */
export function getCurrentPosition(): Promise<DevicePosition> {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo) {
      reject(new Error("This device or browser doesn't support location. Search for a place instead."));
      return;
    }
    geo.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 0,
        }),
      (err) => reject(new Error(geolocationMessage(err.code))),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  });
}
