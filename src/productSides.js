// Door choices per equipment type: Product::sideOptions and ::sideDefault,
// matched on Product::Name = CustomersEquipment::Refrigerator_Type -- the
// office value list "EQP - Avaliable Side Options" and the server's Door
// auto-enter (a Door not in sideOptions becomes sideDefault).
//
// Product isn't in the offline file, so this is a copy: read from
// GasketsRock_Sandbox, Equipment.Product, 2026-10-16 (37 rows; rows without
// sideOptions omitted). Re-read and update if the office edits Product.
// Glass Door's "3" is in the data as-is.
export const PRODUCT_SIDES = {
  "X-Wide Drawer": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "Drawer": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "Half Door": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "Full Door": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "X-Tall Door": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "Anthony Door": { options: ["2 Sided Door", "4 Sided Door", "3 Sided Door"], default: "4 Sided Door" },
  "X-Tall Anthony Door": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "Walk In": { options: ["4 Sided Door", "2 Sided Door", "3 Sided Door"], default: "3 Sided Door" },
  "X-Wide Walk In": { options: ["3 Sided Door", "4 Sided Door", "2 Sided Door"], default: "3 Sided Door" },
  "XX-Wide Walk In": { options: ["3 Sided Door", "4 Sided Door", "2 Sided Door"], default: "3 Sided Door" },
  "Drawer - Screw In": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "X-Wide Drawer - Screw In": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "Half Door - Screw In": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "Full Door - Screw In": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door", "1 Sided Door"], default: "4 Sided Door" },
  "X-Tall Door - Screw In": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "Walk In - Screw In": { options: ["3 Sided Door", "4 Sided Door"], default: "3 Sided Door" },
  "X-Wide Walk In - Screw In": { options: ["3 Sided Door", "4 Sided Door"], default: "3 Sided Door" },
  "XX-Wide Walk In - Screw In": { options: ["3 Sided Door", "4 Sided Door"], default: "3 Sided Door" },
  "Glass Door": { options: ["4 Sided Door", "3", "2 Sided Door"], default: "4 Sided Door" },
  "X-Tall Glass": { options: ["2 Sided Door", "1 Sided Door", "4 Sided Door", "3 Sided Door"], default: "4 Sided Door" },
  "Bevles": { options: ["3 Sided Door", "4 Sided Door", "2 Sided Door"], default: "4 Sided Door" },
  "Henny Penny": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "AltoShaam": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "AltoShaam & Crescor": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "CresCor": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "Metro - Half Door": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
  "Metro - Full Door": { options: ["2 Sided Door", "3 Sided Door", "4 Sided Door"], default: "4 Sided Door" },
};

// FileMaker's = match is case-insensitive ("AltoShaam & Crescor" in Product
// matches "AltoShaam & CresCor" in the warmer type list).
export function sidesFor(type) {
  const key = Object.keys(PRODUCT_SIDES).find((k) => k.toLowerCase() === String(type || "").toLowerCase());
  if (!key) return { options: [], default: "" };
  const { options, default: def } = PRODUCT_SIDES[key];
  // A field-based value list shows its values sorted.
  return { options: [...options].sort((a, b) => a.localeCompare(b)), default: def };
}
