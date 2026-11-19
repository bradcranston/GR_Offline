// -----------------------------------------------------------------------
// Generates the CUSTOMER_EQUIPMENT sync fields as pasteable FileMaker XML.
// -----------------------------------------------------------------------
//   node ./scripts/generate-sync-fields
//
// Paste into Manage Database > Fields with CUSTOMER_EQUIPMENT selected.
// The XML mirrors Locations::__ID as it appears in the DDR -- same
// auto-enter attributes, same uID_CreateWithNoSpaces custom function -- so
// __ID here behaves exactly like every other __ID in the file rather than
// depending on my reading of the "do not replace existing value" flag.
//
// These fields are needed in BOTH the offline file and the server file:
// Initial Download copies fields across by name, and UploadChanges sends
// __ID in the body -- a server that has no such field will reject it.
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");

const TABLE = process.argv[2] || "CUSTOMER_EQUIPMENT";
const OUT_NAME = process.argv[3] || "SyncFields.xml";

const FIELDS = [
  {
    name: "__ID",
    onlyFor: "CUSTOMER_EQUIPMENT",
    dataType: "Text",
    comment:
      "[LLM] System assign UUID for the record. Rows created in the field bring their own from the web viewer, so a row has identity before it ever reaches a server.",
    autoEnterCalc: "uID_CreateWithNoSpaces",
    index: "All",
  },
  {
    name: "f_pendingSync",
    dataType: "Number",
    comment: "1 while this row has local changes the server has not yet accepted.",
    index: "All",
  },
  {
    name: "z_syncAction",
    dataType: "Text",
    comment: "create / update / delete -- what UploadChanges should do with this row.",
    index: "All",
  },
  {
    name: "z_localModTimestamp",
    dataType: "TimeStamp",
    comment: "When the tech last changed this row on this device.",
    index: "None",
  },
  {
    name: "z_serverModTimestamp",
    dataType: "TimeStamp",
    comment:
      "zzModifiedTimestamp as it was at download. Compared against the server's current value to detect a conflicting office edit.",
    index: "None",
  },
  {
    name: "z_lastDownload",
    dataType: "TimeStamp",
    comment:
      "Stamped by Initial Download on every row it received. Rows left with an older stamp were deleted on the server, and are purged locally.",
    index: "All",
  },
  {
    name: "Name",
    onlyFor: "Credential",
    dataType: "Text",
    comment:
      "Which credential this row holds, e.g. \"odata\". Looked up by name so more can be added without touching any script.",
    index: "All",
  },
  {
    name: "Value",
    onlyFor: "Credential",
    dataType: "Text",
    comment:
      "The secret itself, as RECORD DATA so it never appears in a DDR export -- a DDR captures schema (calculations, auto-enter constants, value lists, script text) but not record contents. For OData this is Base64EncodeRFC ( 4648 ; \"account:password\" ), loaded into the master copy before the file is distributed.",
    index: "None",
  },
  {
    name: "Note",
    onlyFor: "Credential",
    dataType: "Text",
    comment: "What this credential is for and which account it belongs to. Not secret.",
    index: "None",
  },
  {
    name: "CustomersJSON",
    onlyFor: "Sync_Settings",
    dataType: "Text",
    comment:
      "The tech's assigned customers as JSON [{__kp_Customer, Customer_Name}], stashed by Initial Download. Feeds the customer picker when a location is created in the field; the offline file has no Customers table.",
    index: "None",
  },
  {
    name: "z_syncError",
    dataType: "Text",
    comment: "Why the last upload attempt was rejected. Empty when clean.",
    index: "None",
  },
];

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function field(spec, id) {
  const hasCalc = Boolean(spec.autoEnterCalc);
  return `  <Field id="${id}" dataType="${spec.dataType}" fieldType="Normal" name="${esc(
    spec.name
  )}">
    <Comment>${esc(spec.comment)}</Comment>
    <AutoEnter allowEditing="${
      hasCalc ? "False" : "True"
    }" overwriteExistingValue="True" alwaysEvaluate="False" constant="False" furigana="False" lookup="False" calculation="${
      hasCalc ? "True" : "False"
    }">
      <ConstantData/>${
        hasCalc
          ? `
      <Calculation table="CUSTOMER_EQUIPMENT">${spec.autoEnterCalc}</Calculation>
      <DisplayCalculation>
        <Chunk type="CustomFunctionRef">${spec.autoEnterCalc}</Chunk>
      </DisplayCalculation>`
          : ""
      }
    </AutoEnter>
    <Validation messageCalc="False" message="False" maxLength="False" valuelist="False" calculation="False" alwaysValidateCalculation="False" type="OnlyDuringDataEntry">
      <NotEmpty value="False"/>
      <Unique value="False"/>
      <Existing value="False"/>
      <StrictValidation value="False"/>
    </Validation>
    <Storage index="${spec.index}" indexLanguage="English" global="False" maxRepetition="1"/>
    <Annotation>
      <Text/>
    </Annotation>
    <DisplayNames enable="False"/>
  </Field>`;
}

// Locations already has its own __ID; only the sync bookkeeping is new there.
// A field tagged onlyFor belongs to that table alone; everything untagged is
// the standard sync set, which Sync_Settings does not want.
// A field tagged onlyFor belongs to that table alone; everything untagged is
// the standard sync set, which the singleton tables do not want.
const SINGLETONS = ["Sync_Settings", "Credential"];
const selected = FIELDS.filter((f) =>
  f.onlyFor ? f.onlyFor === TABLE : !SINGLETONS.includes(TABLE)
);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="FMObjectList">
${selected.map((spec, i) => field(spec, i + 1)).join("\n")}
</fmxmlsnippet>`;

const outPath = path.join(__dirname, "..", "fmscripts", OUT_NAME);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, xml);
console.log(`\x1b[32mWrote ${path.relative(process.cwd(), outPath)} for ${TABLE}\x1b[0m`);

if (process.platform === "darwin") {
  const proc = spawn("pbcopy");
  proc.stdin.write(xml);
  proc.stdin.end();
  proc.on("close", () => {
    exec(
      "osascript -e 'set the clipboard to (do shell script \"pbpaste\" as «class XMFD»)'",
      (error) => {
        if (error) return console.error(error);
        console.log("\x1b[32mCopied as FileMaker fields.\x1b[0m");
      }
    );
  });
}
