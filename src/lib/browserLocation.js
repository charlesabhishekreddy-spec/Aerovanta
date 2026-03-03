const CACHE_KEY = "verdent_browser_location_v1";
const CACHE_TTL_MS = 15 * 60 * 1000;
let inFlightLocationPromise = null;

const readCachedLocation = () => {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const latitude = Number(parsed?.latitude);
    const longitude = Number(parsed?.longitude);
    const timestamp = Number(parsed?.timestamp);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(timestamp)) return null;
    if (Date.now() - timestamp > CACHE_TTL_MS) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
};

const writeCachedLocation = (coords) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        latitude: coords.latitude,
        longitude: coords.longitude,
        timestamp: Date.now(),
      })
    );
  } catch {
    // Ignore storage failures; geolocation still works without cache.
  }
};

const readPosition = (options) =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });

const requestFreshLocation = async () => {
  try {
    const highAccuracy = await readPosition({
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });
    return {
      latitude: highAccuracy.coords.latitude,
      longitude: highAccuracy.coords.longitude,
    };
  } catch {
    try {
      const lowAccuracy = await readPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60 * 1000,
      });
      return {
        latitude: lowAccuracy.coords.latitude,
        longitude: lowAccuracy.coords.longitude,
      };
    } catch {
      return null;
    }
  }
};

export async function getBrowserLocation({ forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : readCachedLocation();
  if (cached) return cached;

  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  if (inFlightLocationPromise) return inFlightLocationPromise;

  inFlightLocationPromise = requestFreshLocation().then((coords) => {
    if (coords) writeCachedLocation(coords);
    return coords;
  }).finally(() => {
    inFlightLocationPromise = null;
  });

  return inFlightLocationPromise;
}

export const clearBrowserLocationCache = () => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore storage failures.
  }
};
