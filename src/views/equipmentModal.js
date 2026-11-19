import { escapeHtml } from "../utils.js";
import { state } from "../store.js";
import { requestManufacturers, requestProfiles } from "../fmBridge.js";
import { sidesFor } from "../productSides.js";
import { showAlert, showConfirm } from "./dialog.js";

// Value lists from the office layout "Equipment - List • New" (GasketsRock,
// DDR 2026-10-15): Product Types, Refrigerator Types, MFGs - Warmer.
const PRODUCT_TYPE_OPTIONS = ["Refrigerator", "Warmer", "Gaskets"];
const WARMER_TYPE_OPTIONS = [
  "Bevles",
  "CresCor",
  "Henny Penny",
  "AltoShaam",
  "AltoShaam & CresCor",
  "Metro - Full Door",
  "Metro - Half Door",
];
// "-" entries render as disabled separators between groups.
const EQUIPMENT_TYPE_OPTIONS = [
  "Drawer",
  "Drawer - Screw In",
  "X-Wide Drawer",
  "X-Wide Drawer - Screw In",
  "-",
  "Anthony Door",
  "Half Door",
  "Half Door - Screw In",
  "Full Door",
  "Full Door - Screw In",
  "X-Tall Anthony Door",
  "X-Tall Door",
  "X-Tall Door - Screw In",
  "Glass Door",
  "X-Tall Glass",
  "-",
  "Walk In",
  "Walk In - Screw In",
  "X-Wide Walk In",
  "X-Wide Walk In - Screw In",
  "XX-Wide Walk In",
  "XX-Wide Walk In - Screw In",
];

const BLANK_ITEM = {
  Label_Number: "",
  ProductType: "",
  Manufacturer: "",
  Refrigerator_Type: "",
  Equipment_Location_Description: "",
  Gasket_Profile: "",
  Door: "",
  DoorOption: "",
  InvertedProfile: "",
  NoMagnet: "",
  Height: "",
  Width: "",
  Qty: "1",
  gasketLinearSub_Ft: "",
  Item_Note: "",
  Custom_Price: "",
  Date_Gasket_Installed: "",
  f_backerRodNeeded: "0",
  f_fillerNeeded: "0",
  f_substitutePart: "0",
};

// Mirrors the server's field validation on CustomersEquipment::Height and
// ::Width (strict, so a POST or PATCH that breaks it is refused): whole
// eighths of an inch, at most 96, except Alto-Shaam heights and Alto-profile
// widths. Caught here, the tech fixes it on the spot; caught at upload, it
// surfaces later as a z_syncError far from the equipment it belongs to.
function measurementError(label, raw, exempt) {
  if (raw === "" || raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return `${label} must be a number.`;
  if (value / 0.125 !== Math.floor(value / 0.125)) {
    return `${label} must be in whole eighths of an inch (e.g. 24.125, 24.25).`;
  }
  if (!exempt && value > 96) return `${label} can't be more than 96 inches.`;
  return null;
}

function validateItem(item) {
  return (
    measurementError("Height", item.Height, item.Manufacturer === "Alto-Shaam") ||
    measurementError("Width", item.Width, (item.Gasket_Profile || "").includes("Alto"))
  );
}

// Multi-value fields (DoorOption, NoMagnet) are return-separated lists in
// FileMaker; JSON carries the separator as \r.
const SIDES = ["Top", "LH", "RH", "Bottom"];
function splitValues(v) {
  return String(v || "")
    .split(/\r\n|\r|\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function joinValues(list) {
  return SIDES.filter((s) => list.includes(s)).join("\r");
}

// Door choices come from Product (productSides.js), keyed on equipment type.
function doorOptionsFor(type) {
  return sidesFor(type).options;
}

// Server auto-enter on CustomersEquipment::DoorOption: the sides a door of
// this kind has by default, set when Door changes.
function defaultDoorOptions(door) {
  if (/4/.test(door)) return [];
  if (/3/.test(door)) return ["LH", "RH", "Top"];
  if (/2/.test(door)) return ["RH", "Top"];
  if (/1/.test(door)) return ["RH"];
  return [];
}

// Server auto-enter on NoMagnet drops "Bottom" for these; the office layout
// hides the Bottom box for the same cases.
function bottomMagnetAllowed(type, door) {
  const t = type || "";
  const d = door || "";
  if (/walk in/i.test(t) && !/4 Sided Door/i.test(d)) return false;
  if (/full door/i.test(t) && /3 Sided Door/i.test(d)) return false;
  if (/anthony door/i.test(t) && /3 Sided Door/i.test(d)) return false;
  return true;
}

// Office conditional formatting on Door: a 3-sided door should have three
// sides ticked, a 2-sided door two.
function doorOptionWarning(door, options) {
  if (door === "3 Sided Door" && options.length !== 3) return "A 3 sided door should have 3 sides ticked.";
  if (door === "2 Sided Door" && options.length !== 2) return "A 2 sided door should have 2 sides ticked.";
  return "";
}

function sidesHtml(name, selected, { hideBottom = false } = {}) {
  const box = (side) =>
    `<label class="side side-${side.toLowerCase()}" ${
      side === "Bottom" && hideBottom ? "hidden" : ""
    }><input type="checkbox" name="${name}" value="${side}" ${
      selected.includes(side) ? "checked" : ""
    } /> ${side}</label>`;
  return `<div class="side-grid">${SIDES.map(box).join("")}</div>`;
}

function optionsHtml(options, selected) {
  const list = selected && !options.includes(selected) ? [...options, selected] : options;
  return list
    .map(
      (opt) =>
        `<option value="${escapeHtml(opt)}" ${opt === selected ? "selected" : ""}>${escapeHtml(opt)}</option>`
    )
    .join("");
}

function equipmentTypeOptionsHtml(productType, selected) {
  if (productType === "Warmer") return optionsHtml(WARMER_TYPE_OPTIONS, selected);
  return EQUIPMENT_TYPE_OPTIONS.map((opt) =>
    opt === "-"
      ? `<option disabled>──────────</option>`
      : `<option value="${escapeHtml(opt)}" ${opt === selected ? "selected" : ""}>${escapeHtml(opt)}</option>`
  ).join("");
}

// FileMaker sends dates as YYYY-MM-DD (ChangeDate_FM_to_JSON), which is what
// <input type="date"> uses; anything else is dropped rather than shown.
function isoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "";
}

// Keeps the current manufacturer selection when re-rendering options after
// FileMaker pushes the manufacturer list in (list may load after the modal
// is already open).
let activeManufacturerSelect = null;
// Same idea as activeManufacturerSelect, but for the gasket profile list.
let activeProfileSelect = null;

function profileOptionsHtml(selected) {
  const names = state.profileList.map((p) => p.__kp_Gasket_Profile);
  const list = selected && !names.includes(selected) ? [...names, selected] : names;
  list.sort((a, b) => a.localeCompare(b));
  return list
    .map(
      (name) =>
        `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(
          name
        )}</option>`
    )
    .join("");
}

export function refreshProfileOptions() {
  if (!activeProfileSelect) return;
  const current = activeProfileSelect.value;
  activeProfileSelect.innerHTML = `
    <option value="">Select...</option>
    ${profileOptionsHtml(current)}
  `;
  activeProfileSelect.value = current;
}

function manufacturerOptionsHtml(selected, productType) {
  let filtered = state.manufacturerList;
  if (productType === "Warmer") {
    filtered = filtered.filter((m) => m.f_makesWarmers === "1");
  } else if (productType === "Refrigerator") {
    filtered = filtered.filter((m) => m.f_makesCoolers === "1");
  }
  const names = filtered.map((m) => m.name);
  const list = selected && !names.includes(selected) ? [...names, selected] : names;
  list.sort((a, b) => a.localeCompare(b));
  return list
    .map(
      (name) =>
        `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(
          name
        )}</option>`
    )
    .join("");
}

export function refreshManufacturerOptions() {
  if (!activeManufacturerSelect) return;
  const current = activeManufacturerSelect.value;
  const productType =
    activeManufacturerSelect.closest("form")?.querySelector('[name="ProductType"]')?.value || "";
  activeManufacturerSelect.innerHTML = `
    <option value="">Select...</option>
    ${manufacturerOptionsHtml(current, productType)}
  `;
  activeManufacturerSelect.value = current;
}

export function openEquipmentModal(container, { item, onSave, onCancel } = {}) {
  const isEdit = !!item;
  const data = { ...BLANK_ITEM, ...(item || {}) };

  if (!state.manufacturerList.length) {
    requestManufacturers();
  }
  if (!state.profileList.length) {
    requestProfiles();
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="${
      isEdit ? "Edit Equipment" : "Add Equipment"
    }">
      <header class="modal-header">
        <h2>${isEdit ? "Edit Equipment" : "Add Equipment"}</h2>
        <button type="button" class="icon-btn" id="modalCloseBtn" aria-label="Close">&#10005;</button>
      </header>
      <form id="equipmentForm" class="equipment-form">
        <div class="form-grid">
          <label>Label #
            <input type="text" name="Label_Number" value="${escapeHtml(data.Label_Number)}" />
          </label>
          <label>Product Type
            <select name="ProductType" id="productTypeSelect">
              ${optionsHtml(PRODUCT_TYPE_OPTIONS, data.ProductType || "Refrigerator")}
            </select>
          </label>
          <label data-show="equipment">Manufacturer
            <select name="Manufacturer" id="manufacturerSelect">
              <option value="">Select...</option>
              ${manufacturerOptionsHtml(data.Manufacturer, data.ProductType || "Refrigerator")}
            </select>
          </label>
          <label data-show="equipment">Equipment Type
            <select name="Refrigerator_Type" id="equipmentTypeSelect">
              <option value="">Select...</option>
              ${equipmentTypeOptionsHtml(data.ProductType || "Refrigerator", data.Refrigerator_Type)}
            </select>
          </label>
          <label class="span-2">Location Description
            <input type="text" name="Equipment_Location_Description" value="${escapeHtml(
              data.Equipment_Location_Description
            )}" placeholder="e.g. Walk in freezer" />
          </label>
          <label>Gasket Profile
            <select name="Gasket_Profile" id="gasketProfileSelect">
              <option value="">Select...</option>
              ${profileOptionsHtml(data.Gasket_Profile)}
            </select>
          </label>
          <label data-show="door">Door Type
            <select name="Door" id="doorSelect"></select>
          </label>
          <div class="span-2 sides-row">
            <fieldset class="sides" data-show="doorOption">
              <legend>Door Sides</legend>
              ${sidesHtml("DoorOption", splitValues(data.DoorOption))}
              <p class="field-warning" id="doorOptionWarning" hidden></p>
            </fieldset>
            <fieldset class="sides">
              <legend>No Magnet</legend>
              ${sidesHtml("NoMagnet", splitValues(data.NoMagnet))}
            </fieldset>
          </div>
          <label>Height (in)
            <input type="number" step="0.125" min="0" inputmode="decimal" name="Height" value="${escapeHtml(
              data.Height
            )}" />
          </label>
          <label>Width (in)
            <input type="number" step="0.125" min="0" inputmode="decimal" name="Width" value="${escapeHtml(
              data.Width
            )}" />
          </label>
          <label>Qty
            <input type="number" step="1" min="0" inputmode="numeric" name="Qty" value="${escapeHtml(
              data.Qty
            )}" />
          </label>
          <label data-show="substitute">Substitute Linear Ft
            <input type="number" step="0.01" inputmode="decimal" name="gasketLinearSub_Ft" value="${escapeHtml(
              data.gasketLinearSub_Ft
            )}" />
          </label>
          <label>Custom Price
            <input type="number" step="0.01" inputmode="decimal" name="Custom_Price" value="${escapeHtml(
              data.Custom_Price
            )}" />
          </label>
          <label>Date Gasket Installed
            <input type="date" name="Date_Gasket_Installed" value="${escapeHtml(
              isoDate(data.Date_Gasket_Installed)
            )}" />
          </label>
          <label class="span-2">Notes
            <textarea name="Item_Note" rows="2">${escapeHtml(data.Item_Note)}</textarea>
          </label>
        </div>

        <div class="checkbox-row">
          <label class="checkbox-label">
            <input type="checkbox" name="InvertedProfile" value="Inverted Profile" ${
              data.InvertedProfile ? "checked" : ""
            } />
            Inverted Profile
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="f_backerRodNeeded" ${
              data.f_backerRodNeeded === "1" ? "checked" : ""
            } />
            Backer Rod Needed
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="f_fillerNeeded" ${
              data.f_fillerNeeded === "1" ? "checked" : ""
            } />
            Filler Needed
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="f_substitutePart" id="substituteBox" ${
              data.f_substitutePart === "1" ? "checked" : ""
            } />
            Substitute Part
          </label>
        </div>


        <footer class="modal-footer">
          <button type="button" class="btn btn-secondary" id="modalCancelBtn">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </footer>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('input[name="Label_Number"]').focus();
  activeManufacturerSelect = overlay.querySelector("#manufacturerSelect");
  activeProfileSelect = overlay.querySelector("#gasketProfileSelect");

  const form = overlay.querySelector("#equipmentForm");
  const productSel = overlay.querySelector("#productTypeSelect");
  const typeSel = overlay.querySelector("#equipmentTypeSelect");
  const doorSel = overlay.querySelector("#doorSelect");
  const checked = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
  const show = (key, visible) =>
    form.querySelectorAll(`[data-show="${key}"]`).forEach((el) => (el.hidden = !visible));

  function renderDoorOptions(selected) {
    const options = doorOptionsFor(typeSel.value);
    doorSel.innerHTML = `<option value="">Select...</option>${optionsHtml(options, selected)}`;
    doorSel.value = selected || "";
  }

  // The office layout's hide conditions, re-run on every change.
  function applyRules() {
    const product = productSel.value;
    const door = doorSel.value;
    show("equipment", product === "Refrigerator" || product === "Warmer");
    show("door", doorSel.options.length > 1);
    show("doorOption", !!door && door !== "4 Sided Door");
    show("substitute", form.querySelector("#substituteBox").checked);
    const bottomOk = bottomMagnetAllowed(typeSel.value, door);
    const bottom = form.querySelector('input[name="NoMagnet"][value="Bottom"]');
    bottom.closest("label").hidden = !bottomOk;
    if (!bottomOk) bottom.checked = false;
    const warning = form.querySelector("#doorOptionWarning");
    const text = door && door !== "4 Sided Door" ? doorOptionWarning(door, checked("DoorOption")) : "";
    warning.textContent = text;
    warning.hidden = !text;
  }

  function setDoorOptions(list) {
    form.querySelectorAll('input[name="DoorOption"]').forEach((el) => (el.checked = list.includes(el.value)));
  }

  renderDoorOptions(data.Door);
  doorSel.dataset.prev = data.Door || "";
  applyRules();

  productSel.addEventListener("change", () => {
    activeManufacturerSelect.innerHTML = `
      <option value="">Select...</option>
      ${manufacturerOptionsHtml("", productSel.value)}
    `;
    activeManufacturerSelect.value = "";
    typeSel.innerHTML = `<option value="">Select...</option>${equipmentTypeOptionsHtml(productSel.value, "")}`;
    typeSel.value = "";
    renderDoorOptions("");
    doorSel.dataset.prev = "";
    setDoorOptions([]);
    applyRules();
  });
  // Server Door auto-enter: a door this type doesn't offer becomes the
  // type's default, and DoorOption follows Door.
  typeSel.addEventListener("change", () => {
    const { options, default: def } = sidesFor(typeSel.value);
    const door = options.includes(doorSel.value) ? doorSel.value : def;
    renderDoorOptions(door);
    if (door !== doorSel.dataset.prev) setDoorOptions(defaultDoorOptions(door));
    doorSel.dataset.prev = door;
    applyRules();
  });
  doorSel.addEventListener("change", () => {
    doorSel.dataset.prev = doorSel.value;
    setDoorOptions(defaultDoorOptions(doorSel.value));
    applyRules();
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "DoorOption" || e.target.name === "NoMagnet" || e.target.id === "substituteBox") {
      applyRules();
    }
  });

  function close() {
    overlay.remove();
    activeManufacturerSelect = null;
    activeProfileSelect = null;
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      close();
      onCancel && onCancel();
    }
  }
  document.addEventListener("keydown", onKeydown);

  overlay.querySelector("#modalCloseBtn").addEventListener("click", () => {
    close();
    onCancel && onCancel();
  });
  overlay.querySelector("#modalCancelBtn").addEventListener("click", () => {
    close();
    onCancel && onCancel();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      close();
      onCancel && onCancel();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const result = { ...data };
    for (const [key, value] of formData.entries()) {
      result[key] = value;
    }
    ["f_backerRodNeeded", "f_fillerNeeded", "f_substitutePart"].forEach((key) => {
      result[key] = formData.has(key) ? "1" : "0";
    });
    // Checkbox groups and single-value boxes: an unticked box sends nothing,
    // so set every one explicitly.
    result.InvertedProfile = formData.has("InvertedProfile") ? "Inverted Profile" : "";
    result.Door = doorSel.value;
    result.DoorOption = result.Door && result.Door !== "4 Sided Door" ? joinValues(checked("DoorOption")) : "";
    result.NoMagnet = joinValues(checked("NoMagnet"));
    const error = validateItem(result);
    if (error) {
      showAlert(error, { title: "Check measurements" });
      return;
    }
    const warning = doorOptionWarning(result.Door, splitValues(result.DoorOption));
    if (
      warning &&
      !(await showConfirm(warning, { title: "Door sides", okLabel: "Save anyway", cancelLabel: "Go back" }))
    ) {
      return;
    }
    close();
    onSave && onSave(result);
  });
}
