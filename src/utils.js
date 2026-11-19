export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatAddress(loc) {
  return [loc.PhysicalAddress1, loc.PhysicalState, loc.PhysicalZip]
    .filter(Boolean)
    .join(", ");
}

// "Updated 4 min ago" style stamp for cached data, so a tech can judge how
// stale what they're looking at is.
export function formatSince(timestamp) {
  if (!timestamp) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString();
}

// Equipment rows carry a client-generated id in __ID. FileMaker's
// CUSTOMER_EQUIPMENT::__ID auto-enters uID_CreateWithNoSpaces for records
// created in the office; rows created here in the field bring their own,
// so a row has a stable identity from the moment a tech taps Save --
// before it has ever reached a server. That is what lets an upload be
// retried safely: a repeat of a request whose response was lost matches
// the existing row instead of creating a second one.
//
// The format matches the house convention (uppercase base 36, 21
// characters) so field-created ids look like every other id in the file.
// It is not structurally identical: uID_Create embeds a NIC address,
// record id and timestamp, so uID_ExtractTimestamp and friends will not
// parse an id generated here. Nothing reads those off equipment records
// today, but it is the reason not to start.
const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ID_LENGTH = 21;

export function makeUuid() {
  const bytes = new Uint8Array(ID_LENGTH);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < ID_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    // 256 % 36 leaves a slight bias toward the first four symbols. At 21
    // characters the collision headroom swamps it, and rejection sampling
    // would buy nothing here.
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

// FileMaker's asJSON calculations emit the literal string "?" where a
// field is empty and JSONSetElement rejected the value -- empty date
// fields in particular. It arrives as data, so "Last Order: ?" renders in
// the UI and "?" lands in form inputs. Strip it at the boundary.
//
// The real fix belongs in the FileMaker calculation; this keeps a stray
// "?" from reaching the tech in the meantime. A genuine note of "?" would
// be blanked, which is an acceptable trade against showing "?" everywhere.
export function normalizeFmJson(value) {
  if (value === "?") return "";
  if (Array.isArray(value)) return value.map(normalizeFmJson);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = normalizeFmJson(val);
    return out;
  }
  return value;
}
