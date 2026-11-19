import { showAlert } from "./dialog.js";
import { escapeHtml } from "../utils.js";
import { state } from "../store.js";

// Which fields a tech may change is dictated by the schema, not preference:
//
//   Location_Name is auto-entered from Brand / Identifier / Number, so the
//   form edits those three components. Writing Location_Name directly gets
//   overwritten by FileMaker on the next commit.
//
//   VisitNextDate is auto-entered from VisitLast + VisitNext, so the tech
//   sets the interval in weeks and the date follows.
//
//   ShipAddress1 and Pricing_ID are lookups from related records. They
//   would appear to save and then silently revert, so they aren't here.
const TEXT_FIELDS = [
  // The server builds Location_Name as Brand - Identifier #Number
  // ("Longhorn Steakhouse - Sunset Valley #5423"); the hints show how.
  { name: "LocationName_Brand", label: "Restaurant / Brand", required: true, hint: "e.g. Longhorn Steakhouse" },
  { name: "LocationName_Identifier", label: "Identifier", hint: "e.g. Sunset Valley" },
  { name: "LocationName_Number", label: "Store #", hint: "e.g. 5423" },
  { name: "PhysicalAddress1", label: "Address", span: true },
  { name: "PhysicalAddress2", label: "Address 2", span: true },
  { name: "PhysicalCity", label: "City" },
  { name: "PhysicalState", label: "State" },
  { name: "PhysicalZip", label: "ZIP" },
];

function customerOptions(selected) {
  const list = state.customers || [];
  if (!list.length) return "";
  return list
    .slice()
    .sort((a, b) =>
      String(a.Customer_Name || "").localeCompare(String(b.Customer_Name || ""))
    )
    .map((c) => {
      const key = c.__kp_Customer;
      return `<option value="${escapeHtml(key)}" ${
        String(key) === String(selected) ? "selected" : ""
      }>${escapeHtml(c.Customer_Name || key)}</option>`;
    })
    .join("");
}

export function openLocationModal(container, { location, isNew, onSave, onCancel } = {}) {
  const data = location || {};
  const customers = state.customers || [];

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="${
      isNew ? "New Location" : "Edit Location"
    }">
      <header class="modal-header">
        <h2>${isNew ? "New Location" : "Edit Location"}</h2>
        <button type="button" class="icon-btn" id="locCloseBtn" aria-label="Close">&#10005;</button>
      </header>
      <form id="locationForm" class="equipment-form">
        <div class="form-grid">
          ${
            isNew
              ? `<label class="span-2">Customer
                  ${
                    customers.length
                      ? `<select name="_kf_Customer" id="customerSelect" required>
                           <option value="">Select...</option>
                           ${customerOptions(data._kf_Customer)}
                         </select>`
                      : `<input type="text" name="_kf_Customer" inputmode="numeric"
                            placeholder="Customer number" value="" />
                         <span class="field-note">No customer list on this device yet &mdash;
                         run Initial Download while connected to get names.</span>`
                  }
                </label>`
              : ""
          }
          ${TEXT_FIELDS.map(
            (f) => `
          <label class="${f.span ? "span-2" : ""}">${escapeHtml(f.label)}${
              f.required ? " *" : ""
            }
            <input type="text" name="${f.name}" value="${escapeHtml(data[f.name] || "")}" ${
              f.required ? "required" : ""
            } ${f.hint ? `placeholder="${escapeHtml(f.hint)}"` : ""} />
          </label>`
          ).join("")}
          <label>Visit every (weeks)
            <input type="number" step="1" min="0" inputmode="numeric" name="VisitNext"
              value="${escapeHtml(data.VisitNext || "")}" />
          </label>
          <label class="span-2">Comments
            <textarea name="Comments" rows="2">${escapeHtml(data.Comments || "")}</textarea>
          </label>
        </div>
        <p class="field-note">
          The location name is assembled by FileMaker from Brand, Identifier and Store #.
          Shipping address and pricing are set in the office.
        </p>
        <footer class="modal-footer">
          <button type="button" class="btn btn-secondary" id="locCancelBtn">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </footer>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  const first = overlay.querySelector("select, input");
  if (first) first.focus();

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(e) {
    if (e.key === "Escape") {
      close();
      onCancel && onCancel();
    }
  }
  document.addEventListener("keydown", onKeydown);

  overlay.querySelector("#locCloseBtn").addEventListener("click", () => {
    close();
    onCancel && onCancel();
  });
  overlay.querySelector("#locCancelBtn").addEventListener("click", () => {
    close();
    onCancel && onCancel();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      close();
      onCancel && onCancel();
    }
  });

  overlay.querySelector("#locationForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const result = {};
    for (const [key, value] of formData.entries()) result[key] = value;

    // _kf_Customer is notEmpty on the server; a create without it is
    // rejected after the tech has already moved on. Catch it here.
    if (isNew && !String(result._kf_Customer || "").trim()) {
      showAlert("Pick a customer before saving this location.", { title: "Customer needed" });
      return;
    }
    close();
    onSave && onSave(result);
  });
}
