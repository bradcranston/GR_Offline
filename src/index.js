import "./style.css";
import {
  performScript,
  whenFileMakerReady,
  requestManufacturers,
  requestProfiles,
} from "./fmBridge.js";
import { state, saveDraft, loadDraft, clearDraft, hasDraft } from "./store.js";
import * as cache from "./cache.js";
import { renderLocationList } from "./views/listView.js";
import { renderLocationDetail } from "./views/detailView.js";
import {
  openEquipmentModal,
  refreshManufacturerOptions,
  refreshProfileOptions,
} from "./views/equipmentModal.js";
import { openLocationModal } from "./views/locationModal.js";
import { makeUuid, normalizeFmJson, escapeHtml } from "./utils.js";
import { showAlert, showConfirm } from "./views/dialog.js";

const root = document.getElementById("app");

// Guards against a slow FileMaker response landing after the tech has
// already navigated somewhere else.
let pendingDetailId = null;

// -----------------------------------------------------------------------
// View rendering
// -----------------------------------------------------------------------
function showLoading(message) {
  root.innerHTML = `<p class="loading-state">${message}</p>`;
}

// An empty list because the route was never downloaded is a completely
// different situation from an empty list because the search matched
// nothing. Saying so is the difference between a tech retrying for ten
// minutes and a tech running Initial Download.
// Any boot failure the tech can act on. A blank screen or a permanent
// spinner tells them nothing; this at least names the thing to check.
function showBootError(headline, detail) {
  state.view = "bootError";
  root.innerHTML = `
    <header class="app-bar"><h1>Gaskets Rock</h1></header>
    <div class="setup-state">
      <p class="setup-headline">${escapeHtml(headline)}</p>
      <p>${escapeHtml(detail)}</p>
      <button class="btn btn-primary" id="retryBtn">Try again</button>
    </div>
  `;
  root.querySelector("#retryBtn").addEventListener("click", () => location.reload());
}

function showNeedsDownload() {
  state.view = "needsDownload";
  root.innerHTML = `
    <header class="app-bar"><h1>Gaskets Rock</h1></header>
    <div class="setup-state">
      <p class="setup-headline">No locations on this device yet.</p>
      <p>Run <strong>Initial Download</strong> from FileMaker while you have a
      connection. Once it finishes, your route is available offline.</p>
      <button class="btn btn-primary" id="retryBtn">Check again</button>
    </div>
  `;
  root.querySelector("#retryBtn").addEventListener("click", bootFromFileMaker);
}

function showList(locations, { savedAt = null, stale = false } = {}) {
  state.view = "list";
  pendingDetailId = null;
  state.locationList = Array.isArray(locations) ? normalizeFmJson(locations) : [];
  state.listSavedAt = savedAt !== null ? savedAt : state.listSavedAt;
  state.listIsStale = stale;
  state.currentLocation = null;
  renderLocationList(root, state.locationList, {
    onSelect: handleSelectLocation,
    onUpload: handleUpload,
    onNewLocation: handleNewLocation,
    pendingCount: state.pendingCount,
    cachedAt: state.listSavedAt,
    stale: state.listIsStale,
  });
}

function showDetail(rawLocation) {
  state.view = "detail";
  const location = normalizeFmJson(rawLocation);
  const draft = loadDraft(location.__ID);
  state.currentLocation = draft
    ? { ...location, CUSTOMER_EQUIPMENT: draft }
    : { ...location };
  renderDetail();
}

function renderDetail() {
  renderLocationDetail(root, state.currentLocation, {
    onBack: handleBack,
    onAddEquipment: handleAddEquipment,
    onEditEquipment: handleEditEquipment,
    onDeleteEquipment: handleDeleteEquipment,
    onSync: handleSync,
    onEditLocation: handleEditLocation,
    hasUnsyncedChanges: hasDraft(state.currentLocation.__ID),
  });
}

// -----------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------
// The FileMaker file holds the location records locally (see "Initial
// Download"), so this is a local query -- it works with no connectivity
// and there is no cached copy to fall back to.
async function handleSelectLocation(id) {
  pendingDetailId = id;
  showLoading("Loading location&hellip;");
  try {
    const location = await performScript("GetLocationDetail", { __ID: id });
    if (pendingDetailId !== id) return;
    if (!location || typeof location !== "object" || !Object.keys(location).length) {
      throw new Error("FileMaker returned no data for this location.");
    }
    showDetail(location);
  } catch (err) {
    if (pendingDetailId !== id) return;
    console.error(err);
    showList(state.locationList, { stale: state.listIsStale });
    showAlert("This location couldn't be opened. Please try again.", { title: "Couldn't open location" });
  }
}

// Saving is local and always works; getting those rows to the server is a
// separate, explicit action so a tech can see when it happened and what
// the office pushed back on.
async function handleUpload(buttonEl) {
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Uploading\u2026";
  }
  try {
    const result = await performScript("UploadChanges", {});
    // The credential and environment guards answer { error } -- without this
    // they read as "Nothing to upload".
    if (result && result.error) throw new Error(result.error);
    const uploaded = (result && result.uploaded) || 0;
    const failed = (result && result.failed) || 0;
    const conflicts = (result && result.conflicts) || [];
    const failures = (result && result.failures) || [];

    if (!uploaded && !failed && !conflicts.length) {
      showAlert("Everything on this iPad is already on the server.", { title: "Nothing to upload" });
    } else {
      const lines = [`${uploaded} change${uploaded === 1 ? "" : "s"} uploaded.`];
      if (failed) {
        lines.push(
          `${failed} could not be sent and will stay queued for the next upload:`,
          ...failures.map((f) => `  \u2022 ${f.label || f.__ID}: ${f.error}`)
        );
      }
      if (conflicts.length) {
        lines.push(
          "",
          `${conflicts.length} item${
            conflicts.length === 1 ? " was" : "s were"
          } also changed in the office since this device downloaded:`,
          ...conflicts.map((c) => `  \u2022 ${c.label || c.__ID}`),
          "",
          "Those were left alone so neither version is lost. Check with the office."
        );
      }
      showAlert(lines.join("\n"), {
        title: failed || conflicts.length ? "Upload finished with problems" : "Upload complete",
      });
    }
  } catch (err) {
    console.error(err);
    showAlert(
      "Your changes are still saved on this iPad and will upload next time." +
        (err && err.message ? "\n\n" + err.message : ""),
      { title: "Upload failed" }
    );
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Upload";
    }
  }
}

// Location edits take the same route as equipment: commit locally, always,
// and leave the network to the explicit Upload step.
async function saveLocation(payload, { isNew }) {
  try {
    const res = await performScript("SaveLocation", payload);
    if (res && res.error) throw new Error(res.error);
    const saved = (res && res.location) || null;
    if (!saved) throw new Error("FileMaker didn't return the saved location.");

    // Keep the list in step so the tech sees the new name without a reload.
    const fresh = normalizeFmJson(saved);
    const i = state.locationList.findIndex((l) => l.__ID === fresh.__ID);
    const listRow = {
      __ID: fresh.__ID,
      Location_Name: fresh.Location_Name,
      PhysicalAddress1: fresh.PhysicalAddress1,
      PhysicalState: fresh.PhysicalState,
      PhysicalZip: fresh.PhysicalZip,
      c_StatusDisplay: fresh.c_StatusDisplay || "Active",
    };
    if (i >= 0) state.locationList[i] = { ...state.locationList[i], ...listRow };
    else state.locationList = [listRow, ...state.locationList];
    cache.saveLocationList(state.locationList);
    state.pendingCount += 1;

    showDetail(fresh);
  } catch (err) {
    console.error(err);
    showAlert(err && err.message ? err.message : "Please try again.", {
      title: isNew ? "Location not created" : "Location not saved",
    });
  }
}

function handleEditLocation() {
  const current = state.currentLocation;
  openLocationModal(root, {
    location: current,
    isNew: false,
    onSave: (values) => saveLocation({ ...values, __ID: current.__ID }, { isNew: false }),
  });
}

function handleNewLocation() {
  openLocationModal(root, {
    isNew: true,
    onSave: (values) =>
      // Identity is minted here, before the row has ever reached FileMaker,
      // for the same reason equipment does it: so a retry can't duplicate it.
      saveLocation({ ...values, __ID: makeUuid(), isNew: true }, { isNew: true }),
  });
}

function handleBack() {
  pendingDetailId = null;
  showList(state.locationList, { stale: state.listIsStale });
}

function handleAddEquipment() {
  openEquipmentModal(root, {
    onSave: (newItem) => {
      // Assign identity here, not on save to FileMaker -- the row must be
      // identifiable while it is still only a local draft. isNew is what lets
      // SaveEquipmentList create it; an unmatched row without it is reported
      // as missing instead, the same rule SaveLocation applies.
      newItem.__ID = makeUuid();
      newItem.isNew = true;
      state.currentLocation.CUSTOMER_EQUIPMENT = [
        ...(state.currentLocation.CUSTOMER_EQUIPMENT || []),
        newItem,
      ];
      persistDraftAndRender();
    },
  });
}

function handleEditEquipment(index) {
  const item = state.currentLocation.CUSTOMER_EQUIPMENT[index];
  openEquipmentModal(root, {
    item,
    onSave: (updatedItem) => {
      // SaveEquipmentList writes and queues only rows flagged isChanged (or
      // isNew); the rest of the list is sent so it can tell what was removed.
      updatedItem.isChanged = true;
      state.currentLocation.CUSTOMER_EQUIPMENT[index] = updatedItem;
      persistDraftAndRender();
    },
  });
}

async function handleDeleteEquipment(index) {
  const item = state.currentLocation.CUSTOMER_EQUIPMENT[index];
  const label = item.Equipment_Location_Description || item.Label_Number || "this item";
  const ok = await showConfirm(`Remove "${label}" from the equipment list?`, {
    title: "Remove equipment?",
    okLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  state.currentLocation.CUSTOMER_EQUIPMENT.splice(index, 1);
  persistDraftAndRender();
}

// One tap: the modal's Save (or a delete) writes straight to FileMaker. The
// draft is kept first so a failed save isn't lost -- the header then offers
// Retry Save.
function persistDraftAndRender() {
  saveDraft(state.currentLocation.__ID, state.currentLocation.CUSTOMER_EQUIPMENT);
  renderDetail();
  handleSync();
}

// A second edit while a save is in flight is folded into one more save
// afterwards, rather than two scripts racing on the same rows.
let saving = false;
let saveAgain = false;

async function handleSync() {
  if (saving) {
    saveAgain = true;
    return;
  }
  const locationId = state.currentLocation.__ID;
  if (!hasDraft(locationId)) return;
  saving = true;
  try {
    const result = await performScript("SaveEquipmentList", {
      __ID: locationId,
      equipment: state.currentLocation.CUSTOMER_EQUIPMENT,
    });
    if (result && result.error) throw new Error(result.error);
    if (result && typeof result.pendingCount === "number") {
      state.pendingCount = result.pendingCount;
    }
    // Edited again while this save ran, or moved to another location: the
    // screen holds newer data than this result. Keep it (and its draft) and
    // let the follow-up save, or the next open, settle it.
    if (saveAgain || !state.currentLocation || state.currentLocation.__ID !== locationId) return;
    const missing = (result && result.missing) || [];
    if (result && result.equipment) {
      // Saved rows are no longer new or changed, and rows FileMaker reported missing
      // aren't on this device any more -- drop them rather than carry them.
      state.currentLocation.CUSTOMER_EQUIPMENT = result.equipment
        .filter((item) => !missing.includes(item.__ID))
        .map(({ isNew, isChanged, ...item }) => item);
    }
    clearDraft(locationId);
    renderDetail();
    if (missing.length) {
      showAlert(
        `${missing.length} item(s) were not saved because they're no longer on this iPad -- ` +
          "most likely removed in the office. Download your route again to see the current list.",
        { title: "Some items not saved" }
      );
    }
  } catch (err) {
    console.error(err);
    showAlert(
      "Your edits are kept in the app -- tap Retry Save to try again." +
        (err && err.message ? "\n\n" + err.message : ""),
      { title: "Couldn't save" }
    );
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      handleSync();
    }
  }
}

// -----------------------------------------------------------------------
// FileMaker-callable entry points.
// FileMaker calls these directly (e.g. via "Perform JavaScript in Web
// Viewer") passing the JSON data as the parameter, either as a JSON string
// or as an already-parsed object. Everything pushed in is written through
// to the offline cache.
// -----------------------------------------------------------------------
function parsePayload(data) {
  return normalizeFmJson(typeof data === "string" ? JSON.parse(data) : data);
}

window.loadLocationList = function (data) {
  const parsed = parsePayload(data);
  cache.saveLocationList(parsed);
  showList(parsed, { savedAt: Date.now(), stale: false });
};

window.loadLocationDetail = function (data) {
  const parsed = parsePayload(data);
  pendingDetailId = parsed && parsed.__ID ? parsed.__ID : null;
  showDetail(parsed);
};

window.loadManufacturers = function (data) {
  const parsed = parsePayload(data);
  state.manufacturerList = Array.isArray(parsed) ? parsed : [];
  cache.saveManufacturers(state.manufacturerList);
  refreshManufacturerOptions();
};

window.loadProfiles = function (data) {
  const parsed = parsePayload(data);
  state.profileList = Array.isArray(parsed) ? parsed : [];
  cache.saveProfiles(state.profileList);
  refreshProfileOptions();
};

window.showAppError = function (message) {
  showAlert(message || "An error occurred.", { title: "Something went wrong" });
};

// Diagnostics for support: `grCache.info()` / `grCache.clear()` from the
// WebViewer console or a FileMaker "Perform JavaScript" step.
window.grCache = {
  info: cache.cacheInfo,
  clear: () => {
    cache.clearCache();
    location.reload();
  },
};

// -----------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------
// Render from the device cache immediately so the app is usable before
// (or entirely without) a FileMaker round-trip. FileMaker's own push then
// overwrites what's on screen with fresh data when it arrives.
// -----------------------------------------------------------------------
function hydrateFromCache() {
  const manufacturers = cache.loadManufacturers();
  if (manufacturers) state.manufacturerList = manufacturers.data;

  const profiles = cache.loadProfiles();
  if (profiles) state.profileList = profiles.data;

  const list = cache.loadLocationList();
  if (!list) return false;
  showList(list.data, { savedAt: list.savedAt, stale: true });
  return true;
}

const hydrated = hydrateFromCache();

// Parcel substitutes this at build time; the dev-only sample import below
// is dropped from a production bundle rather than shipped as a chunk the
// deployed page can never fetch.
const IS_DEV = process.env.NODE_ENV !== "production";

// Ask FileMaker for the list as soon as we can. A pull cannot race the web
// viewer's load the way a timed push can -- we only ask once we exist. The
// cached copy is what the tech looks at meanwhile.
async function bootFromFileMaker() {
  if (!hydrated) showLoading("Loading locations&hellip;");
  try {
    const res = await performScript("GetLocationList", {});
    if (res && res.error) throw new Error(res.error);
    if (res && res.needsDownload) {
      showNeedsDownload();
      return;
    }
    const locations = (res && res.locations) || [];
    state.pendingCount = (res && res.pendingCount) || 0;
    state.customers = (res && res.customers) || [];
    cache.saveLocationList(locations);
    showList(locations, { savedAt: Date.now(), stale: false });
  } catch (err) {
    console.error(err);
    if (hydrated) {
      // The cached list is already on screen; leave it and say it's stale.
      state.listIsStale = true;
      showList(state.locationList, { stale: true });
      return;
    }
    showBootError(
      "Couldn't load your locations.",
      err && err.message ? err.message : "FileMaker didn't respond."
    );
  }
}

(async function boot() {
  if (!hydrated) showLoading("Starting up&hellip;");

  // window.FileMaker appears a moment after this script first runs, so this
  // waits for it rather than deciding on the spot that we are in a browser.
  const ready = await whenFileMakerReady();

  if (ready) {
    bootFromFileMaker();
    // Pull the reference lists up front rather than on first modal open, so
    // the equipment form still works once the tech goes offline.
    if (!state.manufacturerList.length) requestManufacturers();
    if (!state.profileList.length) requestProfiles();
    return;
  }

  if (IS_DEV) {
    if (window.grSimulateOffline && hydrated) {
      console.info("[dev] simulating offline -- serving cached data only");
      return;
    }
    // Local browser bootstrap: stand in for FileMaker's data.
    const mod = await import("../listLocationData.json");
    window.loadLocationList(mod.default || mod);
    if (!state.manufacturerList.length) requestManufacturers();
    if (!state.profileList.length) requestProfiles();
    return;
  }

  // Deployed, but FileMaker never showed up.
  showBootError(
    "This copy of the app can't talk to FileMaker.",
    'Open the web viewer\'s setup and enable "Allow JavaScript to perform FileMaker scripts", then reopen the file.'
  );
})();
