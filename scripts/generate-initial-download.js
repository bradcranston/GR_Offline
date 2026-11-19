// -----------------------------------------------------------------------
// Generates the "Initial Download" FileMaker script as pasteable XML.
// -----------------------------------------------------------------------
//   node ./scripts/generate-initial-download        (writes + copies to clipboard)
//
// Why generate it: the hand-built version repeated the same
// pull-then-create block seven times, which is where the duplicated
// filters, the missing error checks and the inconsistent quoting crept in.
// Here each table is one row of config and the mechanics are emitted once.
//
// What changed vs. the original script
//   1. Credentials are read from _ODataAuth ( ) instead of being inlined.
//   2. $account comes from Get ( AccountName ), not a hardcoded name.
//   3. inSandbox is honoured for every entity, not just Users.
//   4. Child tables are pulled in chunks of CHUNK_SIZE parent ids using an
//      "or" filter instead of one request per parent (~1,700 requests
//      becomes ~40 for a 579-location route).
//   5. Every Insert from URL is followed by an error check that reports
//      through showAppError and exits, instead of failing silently.
//   6. Records are matched on their primary key and updated, so re-running
//      the download no longer duplicates the whole file.
//   7. Runs are refused while unsynced equipment edits are outstanding.
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
const S = require("./fmSteps");

const HOST = "https://gr.cranstonhost.com/fmi/odata/v4/";
const CHUNK_SIZE = 50;

// $select is built from the Sync layout's field list. These are local-only
// bookkeeping fields: they must be on the layout so Set Field By Name can
// write them, but the server has no such columns and would reject a $select
// naming them -- taking the whole download with it.
const LOCAL_ONLY_FIELDS = [
  "f_pendingSync",
  "z_syncAction",
  "z_localModTimestamp",
  "z_serverModTimestamp",
  "z_lastDownload",
  "z_syncError",
];

// Emits a FileMaker calc that lists a layout's fields minus the local-only ones.
function selectFieldsCalc(layoutName) {
  const strip = LOCAL_ONLY_FIELDS.map((f) => `[ "${f}¶" ; "" ]`).join(" ; ");
  return `Substitute ( Substitute ( FieldNames ( Get ( FileName ) ; "${layoutName}" ) & "¶" ; ${strip} ) ; ¶ ; "," )`;
}
const WEBVIEWER = "web";

// Layout ids are the ones exported from the current file. FileMaker
// re-resolves a layout by name on paste, so a stale id is harmless.
const TABLES = [
  {
    name: "LOCATIONS",
    layout: { id: 5, name: "LocationsSync" },
    to: "Locations",
    entity: "Locations",
    pk: "__kp_Location",
    // Filter is a FileMaker calculation fragment, evaluated at run time.
    filter: `"f_isActive eq 1 and (" & $customersFilter & ")"`,
  },
  {
    name: "MANUFACTURERS",
    layout: { id: 27, name: "MFG_ManufacturersSync" },
    to: "MFG_Manufacturers",
    entity: "MFG_Manufacturers",
    pk: "__ID",
    filter: `""`,
  },
  {
    name: "GASKET PROFILES",
    layout: { id: 29, name: "ProfilesSync" },
    to: "Profiles",
    entity: "Profiles",
    pk: "__kp_Gasket_Profile",
    filter: `"f_isActive eq 1 and ProfileType eq 'Gaskets'"`,
  },
  {
    name: "EQUIPMENT",
    layout: { id: 7, name: "EquipmentSync" },
    to: "CUSTOMER_EQUIPMENT",
    entity: "CustomersEquipment", // TO is CUSTOMER_EQUIPMENT; OData wants the base table
    // Match on __ID, never on __kp_CustomerEquipment. Every offline file
    // starts its serial at the same nextValue, so a row created in the
    // field mints a serial that almost certainly belongs to a different
    // piece of equipment on the server -- matching on it would overwrite
    // the wrong record on the next download. __ID is minted per row and
    // survives the round trip, which is the whole reason it exists.
    pk: "__ID",
    chunkBy: { parent: "locations", fk: "_kf_Location", quoted: false },
  },
  {
    name: "CONTACT JOINS",
    layout: { id: 13, name: "ContactsJoinSync" },
    to: "CONj__ContactsJoin",
    entity: "CONj_ContactsJoin", // one underscore: TO is CONj__ContactsJoin
    pk: "__ID",
    chunkBy: { parent: "locations", fk: "_kf_Location", quoted: false },
    filter: `"parentType eq 'Location'"`,
  },
  {
    name: "CONTACTS",
    layout: { id: 15, name: "ContactsSync" },
    to: "CON_Contacts",
    entity: "CON_Contacts",
    pk: "__ID",
    chunkBy: { parent: "contacts", fk: "__ID", quoted: true },
  },
  {
    name: "CONTACT METHODS",
    layout: { id: 17, name: "ContactMethodSync" },
    to: "ContactMethod",
    entity: "ContactMethod",
    pk: "__ID",
    chunkBy: { parent: "contacts", fk: "_ID_Contact", quoted: true },
  },
  {
    name: "ADDRESSES",
    layout: { id: 11, name: "AddressSync" },
    to: "Address",
    entity: "Address",
    pk: "_ID",
    chunkBy: { parent: "addresses", fk: "_ID", quoted: true },
  },
];

// -----------------------------------------------------------------------
// Reusable emitters
// -----------------------------------------------------------------------

// Reports a failure to the webviewer (window.showAppError already exists
// in the widget) and stops, rather than leaving a half-populated file.
function failIf(condition, message) {
  return [
    S.ifStep(condition),
    S.setVar("$error", message),
    // The function name is a calculation, so it must be a quoted string. Bare,
    // FileMaker reads it as an unknown name and comments it out on paste --
    // every error report then calls an empty function name and vanishes.
    S.performJS("$webviewer", `"showAppError"`, ["$error"]),
    S.exitScript(`JSONSetElement ( "{}" ; [ "error" ; $error ; JSONString ] )`),
    S.endIf(),
  ];
}

// Issues one OData GET into $result and verifies it came back as JSON
// without an OData error payload.
function fetchInto(label, urlCalc) {
  return [
    S.setVar("$url", urlCalc),
    S.insertFromURL("$url", "$curl", "$result"),
    ...failIf(
      `Get ( LastError ) ≠ 0`,
      `"${label}: network error " & Get ( LastError ) & " contacting the server. Check the connection and run the download again."`
    ),
    ...failIf(
      `not IsEmpty ( JSONGetElement ( $result ; "error.message" ) )`,
      `"${label}: the server rejected the request -- " & JSONGetElement ( $result ; "error.message" )`
    ),
    ...failIf(
      `JSONGetElement ( $result ; "value" ) = "?"`,
      `"${label}: unexpected response from the server. Nothing was imported."`
    ),
  ];
}

// Walks $result.value[] and upserts each row onto the current layout,
// matching on the table's primary key so re-runs update instead of
// duplicating.
function upsertRows(table) {
  return [
    S.comment(`Upsert ${table.entity} rows from $result`),
    S.setVar("$ii", "0"),
    S.loop(),
    S.setVar("$rowJSON", `JSONGetElement_Valid ( $result ; "value[" & $ii & "]" )`),
    S.exitLoopIf(`IsEmpty ( $rowJSON )`),
    S.setVar("$rowKeys", `JSONlistKeys_Valid ( $result ; "value[" & $ii & "]" )`),
    S.setVar("$pkValue", `JSONGetElement ( $rowJSON ; "${table.pk}" )`),
    S.comment("A row with no key would find nothing and be created again on every run."),
    S.ifStep(`IsEmpty ( $pkValue ) or $pkValue = "?"`),
    S.setVar("$skippedNoKey", "$skippedNoKey + 1"),
    S.elseStep(),
    S.comment(""),
    S.comment("Find the existing record for this key; create one if absent."),
    S.findBy(table.to, table.pk, "$pkValue"),
    S.ifStep(`Get ( LastError ) ≠ 0`),
    S.newRecord(),
    S.endIf(),
    S.comment(""),
    S.setVar("$iii", "0"),
    S.loop(),
    S.setVar("$iii", "$iii + 1"),
    S.setVar("$fieldName", `GetValue ( $rowKeys ; $iii )`),
    S.exitLoopIf(`IsEmpty ( $fieldName )`),
    S.ifStep(`Left ( $fieldName ; 1 ) ≠ "@"`),
    S.setFieldByName(`"${table.to}::" & $fieldName`, `JSONGetElement ( $rowJSON ; $fieldName )`),
    S.endIf(),
    S.endLoop(),
    ...(table.to === "CUSTOMER_EQUIPMENT"
      ? [
          S.comment("Stamp the run so the purge below can tell what the server sent."),
          S.setFieldByName(`"${table.to}::z_lastDownload"`, "$runStamp"),
        ]
      : []),
    ...(table.to === "CUSTOMER_EQUIPMENT" || table.to === "Locations"
      ? [
          S.comment("The server's modification time as of now. UploadChanges compares against"),
          S.comment("it to spot an office edit; without it the conflict check silently never fires."),
          S.comment("(Copying zzModifiedTimestamp by name is useless: the local auto-enter"),
          S.comment("overwrites it on commit.)"),
          S.setFieldByName(
            `"${table.to}::z_serverModTimestamp"`,
            `JSON.Types.GetTimestampFromISO ( $rowJSON ; "zzModifiedTimestamp" )`
          ),
        ]
      : []),
    S.commit(),
    S.setVar("$imported", "$imported + 1"),
    S.endIf(),
    S.setVar("$ii", "$ii + 1"),
    S.endLoop(),
  ];
}

// A table pulled in one request.
function simpleTable(table) {
  const filter = table.filter && table.filter !== `""` ? table.filter : null;
  return [
    S.comment(""),
    S.banner(`PULL ${table.name}`),
    S.setVar("$fields", selectFieldsCalc(table.layout.name)),
    S.goToLayout(table.layout.id, table.layout.name),
    ...fetchInto(
      table.name,
      `$base & "${table.entity}?" & ${
        filter ? `"$filter=" & ${filter} & "&"` : `""`
      } & "$select=" & $fields`
    ),
    ...upsertRows(table),
  ];
}

// A child table pulled in chunks of parent keys.
function chunkedTable(table) {
  const { parent, fk, quoted } = table.chunkBy;
  const q = quoted ? `"'" & $key & "'"` : `$key`;
  const extra = table.filter ? `${table.filter} & " and "` : `""`;
  return [
    S.comment(""),
    S.banner(`PULL ${table.name}`),
    S.setVar("$fields", selectFieldsCalc(table.layout.name)),
    S.setVar("$keys", `$${parent}Keys`),
    S.setVar("$k", "0"),
    S.goToLayout(table.layout.id, table.layout.name),
    S.comment(""),
    S.comment(`Chunk the parent keys ${CHUNK_SIZE} at a time into one "or" filter.`),
    S.loop(),
    S.setVar("$chunk", `""`),
    S.setVar("$n", "0"),
    S.loop(),
    S.setVar("$k", "$k + 1"),
    S.setVar("$key", `GetValue ( $keys ; $k )`),
    S.exitLoopIf(`IsEmpty ( $key )`),
    S.setVar(
      "$chunk",
      `$chunk & If ( IsEmpty ( $chunk ) ; "" ; " or " ) & "${fk} eq " & ${q}`
    ),
    S.setVar("$n", "$n + 1"),
    S.exitLoopIf(`$n ≥ ${CHUNK_SIZE}`),
    S.endLoop(),
    S.exitLoopIf(`IsEmpty ( $chunk )`),
    S.comment(""),
    ...fetchInto(
      table.name,
      `$base & "${table.entity}?$filter=" & ${extra} & "(" & $chunk & ")&$select=" & $fields`
    ),
    ...upsertRows(table),
    S.endLoop(),
  ];
}

// -----------------------------------------------------------------------
// Script body
// -----------------------------------------------------------------------
function build() {
  const steps = [
    S.comment("Description: Downloads this tech's route into the local tables for offline use."),
    S.comment("#################### #"),
    S.comment("Generated by scripts/generate-initial-download.js -- edit that, not this."),
    S.comment("----- Change Log ----- #"),
    S.comment("----- End Log ----- #"),
    S.comment("#################### #"),
    S.comment(""),
    S.banner("INITIALIZE"),
    S.setErrorCapture(true),
    S.allowUserAbort(false),
    S.setVar("$webviewer", `"${WEBVIEWER}"`),
    S.setVar("$imported", "0"),
    S.setVar("$skippedNoKey", "0"),
    S.setVar("$startedAt", "Get ( CurrentTimestamp )"),
    S.setVar("$runStamp", "Get ( CurrentTimestamp )"),
    S.setVar(
      "$database",
      `Case ( inSandbox ; "GSR_Gaskets Rock_Sandbox" ; "GSR_Gaskets Rock" )`
    ),
    S.comment(""),
    S.comment("Credentials come from the _ODataAuth custom function, which should read"),
    S.comment("them from a server-hosted account -- never inline them in a script that"),
    S.comment("ships on a field device."),
    S.setVar("$base", `${JSON.stringify(HOST)} & Case ( inSandbox ; "GSR_Gaskets Rock_Sandbox" ; "GSR_Gaskets Rock" ) & "/"`),
    S.setVar(
      "$curl",
      [
        '"--X GET',
        '--H \\"Accept: application/json\\"',
        '--H \\"OData-Version: 4.0\\"',
        '--H \\"OData-MaxVersion: 4.0\\"',
        '--H \\"Authorization: Basic " & _ODataAuth ( ) & "\\"',
        "--location",
        "--dump-header $headerResponse",
        '"',
      ].join("\n")
    ),
    S.comment(""),
    S.banner("GUARD: CREDENTIALS"),
    S.comment("_ODataAuth reads the Credential table, which is record data loaded into"),
    S.comment("the master copy before distribution -- deliberately not schema, so it never"),
    S.comment("appears in a DDR export. An unconfigured copy would otherwise fail with a"),
    S.comment("401 that looks like a server problem."),
    ...failIf(
      `IsEmpty ( _ODataAuth ( ) )`,
      `"This copy has no server credentials. It was distributed without them -- ask the office for a configured copy."`
    ),
    S.comment(""),
    S.banner("GUARD: UNSYNCED EDITS"),
    S.comment("A download overwrites local records. Refuse to run while the tech still"),
    S.comment("has equipment edits that haven't made it back to the server."),
    S.setVar(
      "$pendingEdits",
      `Max ( 0 ; GetAsNumber ( ExecuteSQL ( "select count(*) from \\"CUSTOMER_EQUIPMENT\\" where \\"f_pendingSync\\" = 1" ; "" ; "" ) ) ) + Max ( 0 ; GetAsNumber ( ExecuteSQL ( "select count(*) from \\"Locations\\" where \\"f_pendingSync\\" = 1" ; "" ; "" ) ) )`
    ),
    ...failIf(
      `$pendingEdits > 0`,
      `$pendingEdits & " change(s) haven't been uploaded yet. Run Upload Changes first, then download."`
    ),
    S.comment(""),
    S.banner("RESOLVE THIS TECH'S CUSTOMERS"),
    S.setVar("$account", "Get ( AccountName )"),
    ...fetchInto(
      "Customer list",
      `$base & "Users?$filter=Account_Name eq '" & $account & "'&$select=CustomersAssigned"`
    ),
    S.setVar("$customers", `JSONGetElement_Valid ( $result ; "value[0]CustomersAssigned" )`),
    ...failIf(
      `IsEmpty ( $customers )`,
      `"No customers are assigned to the account " & $account & ". Ask the office to assign your route before downloading."`
    ),
    S.comment(""),
    S.comment(`Turn "12, 34, 56" into "_kf_Customer eq 12 or _kf_Customer eq 34 or ..."`),
    S.setVar(
      "$customerIDs",
      `Substitute ( $customers ; [ "\\"" ; "" ] ; [ " " ; "" ] )`
    ),
    S.setVar(
      "$customersFilter",
      `"_kf_Customer eq " & Substitute ( $customerIDs ; "," ; " or _kf_Customer eq " )`
    ),
    S.setVar(
      "$customerKeyFilter",
      `"__kp_Customer eq " & Substitute ( $customerIDs ; "," ; " or __kp_Customer eq " )`
    ),
    S.comment(""),
    S.banner("PULL CUSTOMER NAMES"),
    S.comment("The offline file has no Customers table -- Customer_Name there is a"),
    S.comment("stub that returns empty. Without names, a customer picker on a new"),
    S.comment("location can only offer account numbers, which is no use to a tech."),
    S.comment("Stash the list as JSON rather than adding a whole table for it."),
    ...fetchInto(
      "Customer names",
      `$base & "Customers?$filter=" & $customerKeyFilter & "&$select=__kp_Customer,Customer_Name"`
    ),
    S.setVar("$customerList", `JSONGetElement ( $result ; "value" )`),
    S.comment(""),
  ];

  // Locations first -- the child pulls key off them.
  steps.push(...simpleTable(TABLES[0]));
  steps.push(
    S.comment(""),
    S.setVar("$locationsKeys", `ExecuteSQL ( "select \\"__kp_Location\\" from \\"Locations\\"" ; "" ; "" )`)
  );

  // Reference lists.
  steps.push(...simpleTable(TABLES[1]));
  steps.push(...simpleTable(TABLES[2]));

  // Equipment + contact joins hang off locations.
  steps.push(...chunkedTable(TABLES[3]));
  steps.push(...chunkedTable(TABLES[4]));

  steps.push(
    S.comment(""),
    S.setVar(
      "$contactsKeys",
      `ExecuteSQL ( "select distinct \\"_ID_Contact\\" from \\"CONj__ContactsJoin\\"" ; "" ; "" )`
    )
  );
  steps.push(...chunkedTable(TABLES[5]));
  steps.push(...chunkedTable(TABLES[6]));

  steps.push(
    S.comment(""),
    S.comment("Addresses are referenced by the three id fields on each location."),
    S.setVar(
      "$addressesKeys",
      `ExecuteSQL ( "select \\"AddressBill_ID\\" from \\"Locations\\" where \\"AddressBill_ID\\" is not null" ; "" ; "" ) & ¶ & ExecuteSQL ( "select \\"AddressPhysical_ID\\" from \\"Locations\\" where \\"AddressPhysical_ID\\" is not null" ; "" ; "" ) & ¶ & ExecuteSQL ( "select \\"AddressShip_ID\\" from \\"Locations\\" where \\"AddressShip_ID\\" is not null" ; "" ; "" )`
    )
  );
  steps.push(...chunkedTable(TABLES[7]));

  steps.push(
    S.comment(""),
    S.banner("PURGE EQUIPMENT DELETED ON THE SERVER"),
    S.comment("Every row the server sent carries this run's stamp. Anything older was"),
    S.comment("deleted in the office, and a tech looking at equipment that no longer"),
    S.comment("exists wastes a site visit."),
    S.comment(""),
    S.comment("Rows with pending edits are never purged. The guard at the top already"),
    S.comment("refuses to run while any exist, so this is belt and braces -- but the"),
    S.comment("belt is what stops a download destroying a day's work."),
    S.setVar(
      "$stale",
      `ExecuteSQL ( "select \\"__ID\\" from \\"CUSTOMER_EQUIPMENT\\" where ( \\"z_lastDownload\\" is null or \\"z_lastDownload\\" <> ? ) and ( \\"f_pendingSync\\" is null or \\"f_pendingSync\\" <> 1 )" ; "" ; "" ; $runStamp )`
    ),
    S.setVar("$purged", "0"),
    S.goToLayout(7, "EquipmentSync"),
    S.setVar("$p", "0"),
    S.loop(),
    S.setVar("$p", "$p + 1"),
    S.setVar("$staleID", `GetValue ( $stale ; $p )`),
    S.exitLoopIf(`IsEmpty ( $staleID )`),
    S.findBy("CUSTOMER_EQUIPMENT", "__ID", "$staleID"),
    S.ifStep(`Get ( LastError ) = 0`),
    S.deleteRecord(),
    S.setVar("$purged", "$purged + 1"),
    S.endIf(),
    S.endLoop(),
    S.comment(""),
    S.banner("FINISH"),
    S.comment("Sync_Settings already exists for this; a global would die with the file,"),
    S.comment("which is exactly when a tech needs to know how stale their route is."),
    S.goToLayout(4, "Sync_Settings"),
    S.ifStep("Get ( FoundCount ) = 0"),
    S.newRecord(),
    S.endIf(),
    S.setFieldByName(`"Sync_Settings::LastSyncUTC"`, "Get ( CurrentTimeUTCMilliseconds )"),
    S.setFieldByName(`"Sync_Settings::Initialized"`, `"1"`),
    S.comment("Record which database this device's data came from. UploadChanges"),
    S.comment("refuses to run when the file's current target does not match, so a"),
    S.comment("renamed or duplicated file cannot push sandbox edits into production."),
    S.setFieldByName(`"Sync_Settings::DatabaseUUID"`, "$database"),
    S.setFieldByName(`"Sync_Settings::CustomersJSON"`, "$customerList"),
    S.commit(),
    S.setVar("$$LAST_DOWNLOAD", "Get ( CurrentTimestamp )"),
    S.setVar(
      "$summary",
      `JSONSetElement ( "{}" ; [ "records" ; $imported ; JSONNumber ] ; [ "seconds" ; Get ( CurrentTimestamp ) - $startedAt ; JSONNumber ] ; [ "downloadedAt" ; GetAsText ( $$LAST_DOWNLOAD ) ; JSONString ] ; [ "purged" ; $purged ; JSONNumber ] ; [ "database" ; $database ; JSONString ] )`
    ),
    S.exitScript("$summary")
  );

  return S.wrap(steps, { scriptName: "Initial Download" });
}

const xml = build();
const outPath = path.join(__dirname, "..", "fmscripts", "InitialDownload.xml");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, xml);
console.log(`\x1b[32mWrote ${path.relative(process.cwd(), outPath)}\x1b[0m`);

if (process.platform === "darwin") {
  const proc = spawn("pbcopy");
  proc.stdin.write(xml);
  proc.stdin.end();
  proc.on("close", () => {
    exec(
      "osascript -e 'set the clipboard to (do shell script \"pbpaste\" as «class XMSC»)'",
      (error) => {
        if (error) return console.error(error);
        console.log("\x1b[32mCopied as a whole FileMaker script -- paste into the scripts list in Script Workspace (rename the old one first).\x1b[0m");
      }
    );
  });
}
