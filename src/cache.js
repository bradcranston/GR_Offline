// -----------------------------------------------------------------------
// Boot cache
// -----------------------------------------------------------------------
// The real offline store for this app is the FileMaker file itself: the
// "Initial Download" script pulls Locations, Equipment, Contacts,
// Manufacturers and Profiles into local FileMaker tables, so every script
// the widget calls is a local query that works with no connectivity.
//
// This cache therefore exists for one narrow reason: the WebViewer can
// reload (or be re-rendered on layout enter) before FileMaker has pushed
// its data in, which leaves the tech looking at an empty screen. Caching
// the last pushed payloads lets the app paint immediately; FileMaker's
// push then overwrites it a moment later.
//
// It is deliberately NOT a copy of the record data -- per-location detail
// is always read live from the FileMaker tables, so it can't drift.
//
// Equipment edits are not stored here either; those are drafts in store.js.
// -----------------------------------------------------------------------

const NS = "gr_cache_";
const VERSION = 2;

const KEY_LIST = `${NS}locationList`;
const KEY_MANUFACTURERS = `${NS}manufacturers`;
const KEY_PROFILES = `${NS}profiles`;

const ALL_KEYS = [KEY_LIST, KEY_MANUFACTURERS, KEY_PROFILES];

function read(key) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw);
    if (!envelope || envelope.v !== VERSION) return null;
    return envelope;
  } catch (e) {
    return null;
  }
}

function write(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: VERSION, savedAt: Date.now(), data }));
    return true;
  } catch (e) {
    // A failed cache write must never break the in-memory app -- worst
    // case the next reload paints a moment later than it could have.
    console.warn("[cache] write failed", key, e);
    return false;
  }
}

function readList(key) {
  const envelope = read(key);
  if (!envelope || !Array.isArray(envelope.data)) return null;
  return { data: envelope.data, savedAt: envelope.savedAt };
}

export function saveLocationList(list) {
  return Array.isArray(list) ? write(KEY_LIST, list) : false;
}

export function loadLocationList() {
  return readList(KEY_LIST);
}

export function saveManufacturers(list) {
  return Array.isArray(list) ? write(KEY_MANUFACTURERS, list) : false;
}

export function loadManufacturers() {
  return readList(KEY_MANUFACTURERS);
}

export function saveProfiles(list) {
  return Array.isArray(list) ? write(KEY_PROFILES, list) : false;
}

export function loadProfiles() {
  return readList(KEY_PROFILES);
}

export function cacheInfo() {
  const list = loadLocationList();
  return {
    listSavedAt: list ? list.savedAt : null,
    listCount: list ? list.data.length : 0,
  };
}

export function clearCache() {
  ALL_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  });
}
