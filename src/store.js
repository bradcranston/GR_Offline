// -----------------------------------------------------------------------
// App state + local "offline" draft persistence.
// Equipment edits are saved to localStorage immediately so field techs
// don't lose work if connectivity to FileMaker drops or the app reloads.
// A location's draft is cleared once it has been synced back to FileMaker.
// -----------------------------------------------------------------------

const DRAFT_KEY_PREFIX = "gr_equipment_draft_";

export const state = {
  view: "list",
  locationList: [],
  currentLocation: null,
  manufacturerList: [],
  profileList: [],
  // When the location list on screen was last cached, and whether it is
  // still the cached copy rather than a fresh push from FileMaker.
  listSavedAt: null,
  listIsStale: false,
  // Equipment rows saved on this device but not yet accepted by the server.
  pendingCount: 0,
  // Assigned customers, for the picker when a location is created in the
  // field. Sent by GetLocationList from Sync_Settings::CustomersJSON.
  customers: [],
};

export function saveDraft(locationId, equipment) {
  if (!locationId) return;
  localStorage.setItem(DRAFT_KEY_PREFIX + locationId, JSON.stringify(equipment));
}

export function loadDraft(locationId) {
  if (!locationId) return null;
  const raw = localStorage.getItem(DRAFT_KEY_PREFIX + locationId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearDraft(locationId) {
  if (!locationId) return;
  localStorage.removeItem(DRAFT_KEY_PREFIX + locationId);
}

export function hasDraft(locationId) {
  if (!locationId) return false;
  return localStorage.getItem(DRAFT_KEY_PREFIX + locationId) !== null;
}
