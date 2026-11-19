import { escapeHtml } from "../utils.js";

// Contacts arrive nested as CONj__ContactsJoin[].Contacts[]; flatten for display.
function getContacts(location) {
  const groups = location.CONj__ContactsJoin || [];
  const contacts = [];
  groups.forEach((group) => {
    (group.Contacts || []).forEach((contact) => contacts.push(contact));
  });
  return contacts;
}

function contactName(contact) {
  return (
    contact.FullName ||
    [contact.FirstName, contact.LastName].filter(Boolean).join(" ") ||
    "Contact"
  );
}

function renderInfoRow(label, value) {
  if (!value) return "";
  return `<div class="info-row"><span class="info-label">${escapeHtml(
    label
  )}</span><span class="info-value">${escapeHtml(value)}</span></div>`;
}

export function renderLocationDetail(
  root,
  location,
  {
    onBack,
    onAddEquipment,
    onEditEquipment,
    onDeleteEquipment,
    onSync,
    onEditLocation,
    hasUnsyncedChanges,
  } = {}
) {
  const equipment = location.CUSTOMER_EQUIPMENT || [];
  const contacts = getContacts(location);
  const locationName = location.Location_Name || location.BillLocationName || "Location";

  const billAddress = [
    location.BillAddress1,
    location.BillAddress2,
    [location.BillCity, location.BillState, location.BillZip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ");

  const shipAddress = [
    location.ShipAddress1,
    location.ShipAddress2,
    [location.ShipCity, location.ShipState, location.ShipZip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ");

  root.innerHTML = `
    <header class="app-bar app-bar-detail">
      <button class="icon-btn back-btn" id="backBtn" aria-label="Back to locations">&#8249;</button>
      <h1 class="app-bar-title">${escapeHtml(locationName)}</h1>
      <button class="icon-btn" id="editLocationBtn" aria-label="Edit location">&#9998;</button>
      ${
        hasUnsyncedChanges
          ? `<button class="btn btn-sync-pending" id="syncBtn">Retry Save</button>`
          : ""
      }
    </header>

    <section class="location-info">
      <p>${escapeHtml(location.PhysicalAddress1)}${
    location.PhysicalAddress2 ? " " + escapeHtml(location.PhysicalAddress2) : ""
  }</p>
      <p>${escapeHtml(location.PhysicalCity)}, ${escapeHtml(location.PhysicalState)} ${escapeHtml(
    location.PhysicalZip
  )}</p>
    </section>

    <details class="info-section">
      <summary>Location Details</summary>
      <div class="info-grid">
        ${renderInfoRow("Last Order", location.LastOrder)}
        ${renderInfoRow("Last Visit", location.VisitLast)}
        ${renderInfoRow("Next Visit", location.VisitNextDate)}
        ${renderInfoRow("Next Visit (weeks)", location.VisitNext)}
        ${renderInfoRow("Pricing Level", location.Pricing_Level)}
        ${renderInfoRow("Tax Exempt", location.TaxExempt)}
        ${renderInfoRow("Billing Address", billAddress)}
        ${renderInfoRow("Shipping Location", location.ShipLocationName)}
        ${renderInfoRow("Shipping Address", shipAddress)}
      </div>
    </details>

    <details class="info-section" ${contacts.length ? "" : "hidden"}>
      <summary>Contacts (${contacts.length})</summary>
      <ul class="contact-list">
        ${contacts
          .map((contact) => {
            const methods = (contact.ContactMethod || [])
              .filter((m) => m.Data)
              .map(
                (m) =>
                  `<span class="contact-method">${escapeHtml(m.Type || "")}: ${escapeHtml(
                    m.Data
                  )}</span>`
              )
              .join("");
            return `
            <li class="contact-item">
              <span class="contact-name">${escapeHtml(contactName(contact))}</span>
              ${methods}
            </li>`;
          })
          .join("")}
      </ul>
    </details>

    <section class="equipment-section">
      <div class="section-header">
        <h2>Equipment List (${equipment.length})</h2>
        <button class="btn btn-primary" id="addEquipmentBtn">+ Add Equipment</button>
      </div>
      <ul class="equipment-list" id="equipmentListEl"></ul>
      <p class="empty-state" id="equipmentEmptyState" hidden>
        No equipment items yet. Tap "Add Equipment" to create one.
      </p>
    </section>
  `;

  const listEl = root.querySelector("#equipmentListEl");
  const emptyEl = root.querySelector("#equipmentEmptyState");

  if (!equipment.length) {
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
    listEl.innerHTML = equipment
      .map((item, index) => {
        const title =
          item.Equipment_Location_Description || item.ProductType || "Equipment";
        const sub = [item.Manufacturer, item.ProductType, item.Gasket_Profile ? `Gasket ${item.Gasket_Profile}` : null]
          .filter(Boolean)
          .join(" · ");
        return `
        <li class="equipment-item" data-index="${index}">
          <div class="equipment-main">
            <span class="equipment-label">#${escapeHtml(item.Label_Number || index + 1)}</span>
            <div class="equipment-detail">
              <span class="equipment-title">${escapeHtml(title)}</span>
              <span class="equipment-sub">${escapeHtml(sub)}</span>
            </div>
          </div>
          <div class="equipment-actions">
            <button class="icon-btn edit-btn" data-index="${index}" aria-label="Edit equipment">&#9998;</button>
            <button class="icon-btn delete-btn" data-index="${index}" aria-label="Delete equipment">&#128465;</button>
          </div>
        </li>`;
      })
      .join("");
  }

  root.querySelector("#backBtn").addEventListener("click", () => onBack && onBack());
  const syncBtn = root.querySelector("#syncBtn");
  if (syncBtn) syncBtn.addEventListener("click", () => onSync && onSync());
  root
    .querySelector("#editLocationBtn")
    .addEventListener("click", () => onEditLocation && onEditLocation());
  root
    .querySelector("#addEquipmentBtn")
    .addEventListener("click", () => onAddEquipment && onAddEquipment());

  listEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".edit-btn");
    const deleteBtn = e.target.closest(".delete-btn");
    if (editBtn) {
      onEditEquipment && onEditEquipment(Number(editBtn.dataset.index));
      return;
    }
    if (deleteBtn) {
      onDeleteEquipment && onDeleteEquipment(Number(deleteBtn.dataset.index));
      return;
    }
    const item = e.target.closest(".equipment-item");
    if (item) {
      onEditEquipment && onEditEquipment(Number(item.dataset.index));
    }
  });
}
