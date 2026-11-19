import { escapeHtml, formatAddress, formatSince } from "../utils.js";

export function renderLocationList(
  root,
  locations,
  { onSelect, onUpload, onNewLocation, pendingCount = 0, cachedAt = null, stale = false } = {}
) {
  const items = locations || [];
  const cacheNote = cachedAt
    ? `${stale ? "Offline copy" : "Updated"} \u00b7 ${formatSince(cachedAt)}`
    : "";

  root.innerHTML = `
    <header class="app-bar">
      <h1>Locations</h1>
      ${
        cacheNote
          ? `<span class="cache-note ${stale ? "cache-note-stale" : ""}">${escapeHtml(
              cacheNote
            )}</span>`
          : ""
      }
      <button class="btn btn-secondary btn-new-location" id="newLocationBtn">+ Location</button>
      <button class="btn btn-upload ${
        pendingCount ? "btn-upload-pending" : ""
      }" id="uploadBtn">Upload${pendingCount ? ` (${pendingCount})` : ""}</button>
    </header>
    <div class="search-bar">
      <input
        type="search"
        id="locationSearch"
        class="search-input"
        placeholder="Search by name, city, state, or zip..."
        autocomplete="off"
      />
    </div>
    <ul class="location-list" id="locationListEl"></ul>
    <p class="empty-state" id="locationEmptyState" hidden>No locations found.</p>
  `;

  const listEl = root.querySelector("#locationListEl");
  const emptyEl = root.querySelector("#locationEmptyState");
  const searchEl = root.querySelector("#locationSearch");

  function draw(filtered) {
    if (!filtered.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = filtered
      .map((loc) => {
        const isActive = loc.c_StatusDisplay === "Active";
        return `
        <li class="location-item" data-id="${escapeHtml(loc.__ID)}" tabindex="0" role="button">
          <div class="location-item-main">
            <span class="location-name">${escapeHtml(loc.Location_Name)}</span>
            <span class="location-address">${escapeHtml(formatAddress(loc))}</span>
          </div>
          <span class="status-badge ${isActive ? "status-active" : "status-inactive"}">${escapeHtml(
            loc.c_StatusDisplay || "Unknown"
          )}</span>
          <span class="chevron" aria-hidden="true">&#8250;</span>
        </li>`;
      })
      .join("");
  }

  draw(items);

  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim().toLowerCase();
    const filtered = !q
      ? items
      : items.filter((loc) =>
          [loc.Location_Name, loc.PhysicalAddress1, loc.PhysicalState, loc.PhysicalZip]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        );
    draw(filtered);
  });

  const newLocEl = root.querySelector("#newLocationBtn");
  if (newLocEl) {
    newLocEl.addEventListener("click", () => onNewLocation && onNewLocation());
  }

  const uploadEl = root.querySelector("#uploadBtn");
  if (uploadEl) {
    uploadEl.addEventListener("click", () => onUpload && onUpload(uploadEl));
  }

  listEl.addEventListener("click", (e) => {
    const item = e.target.closest(".location-item");
    if (!item) return;
    onSelect && onSelect(item.dataset.id);
  });

  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".location-item");
    if (!item) return;
    e.preventDefault();
    onSelect && onSelect(item.dataset.id);
  });
}
