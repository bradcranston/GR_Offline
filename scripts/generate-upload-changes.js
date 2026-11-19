// -----------------------------------------------------------------------
// Generates the "UploadChanges" FileMaker script as pasteable XML.
// -----------------------------------------------------------------------
//   node ./scripts/generate-upload-changes
//
// The return trip. Sends every row flagged f_pendingSync = 1 to the server
// over OData, in two passes:
//
//   1. Locations  -- create / update
//   2. Equipment  -- create / update / delete
//
// Locations go first because equipment hangs off them. A location created
// in the field carries a negative __kp_Location (the offline file's own
// serial counts down from -1, so it can never collide with a server key).
// When the server accepts the create it assigns the real key; this script
// writes that back and repoints the location's equipment at it *before*
// the equipment pass runs, so equipment never reaches the server pointing
// at a key the server has never heard of.
//
// Requires the _ODataAuth custom function (returns the base64 of
// "account:password" for a scoped OData account).
//
// Structure note: FileMaker scripts have no `continue`. Every stage of a
// row therefore runs under `If ( IsEmpty ( $err ) and not $skip )`, and
// the loop index advances in exactly one place. An earlier draft advanced
// it in several branches and let a conflicting row fall through into the
// send step; don't reintroduce either.
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const S = require("./fmSteps");

const HOST = "https://gr.cranstonhost.com/fmi/odata/v4/";
const WEBVIEWER = "web";
const AUTH_FN = "_ODataAuth ( )";

// OData addresses base tables, not table occurrences (proven against the
// sandbox: /Profiles and /Users resolve, and neither has a TO of that name).
const PASSES = [
  {
    label: "LOCATIONS",
    to: "Locations",
    entity: "Locations",
    layout: { id: 5, name: "LocationsSync" },
    serverKey: "__kp_Location",
    allowDelete: false,
    text: [
      "LocationName_Brand",
      "LocationName_Identifier",
      "LocationName_Number",
      "PhysicalAddress1",
      "PhysicalAddress2",
      "PhysicalCity",
      "PhysicalState",
      "PhysicalZip",
      "Comments",
    ],
    number: ["VisitNext"],
    date: [],
    createOnlyNumbers: ["_kf_Customer"],
  },
  {
    label: "EQUIPMENT",
    to: "CUSTOMER_EQUIPMENT",
    entity: "CUSTOMER_EQUIPMENT", // OData addresses table occurrences; no TO is named CustomersEquipment (404, iPad 2026-10-15)
    layout: { id: 7, name: "EquipmentSync" },
    serverKey: "__kp_CustomerEquipment",
    allowDelete: true,
    parentKey: "_kf_Location",
    text: [
      "ProductType",
      "Manufacturer",
      "Refrigerator_Type",
      "Equipment_Location_Description",
      "Gasket_Profile",
      "Door",
      "DoorOption",
      "InvertedProfile",
      "NoMagnet",
      "Item_Note",
    ],
    number: [
      "Label_Number",
      "Height",
      "Width",
      "Qty",
      "gasketLinearSub_Ft",
      "Custom_Price",
      "f_backerRodNeeded",
      "f_fillerNeeded",
      "f_substitutePart",
      // _kf_Equipment is deliberately absent. Despite the _kf_ prefix it is
      // not a foreign key: it is a second auto-enter serial on this table
      // (server next value 823978, ten behind __kp_CustomerEquipment), a
      // leftover primary key that nothing reads and no relationship uses.
      // The server fills it on create. Sending it would push this device's
      // local serial into the server's field for no gain.
    ],
    date: ["Date_Gasket_Installed"],
    createOnlyNumbers: ["_kf_Location"],
  },
];

function curlFor(method, withBody) {
  const parts = [
    `"--X ${method}`,
    '--H \\"Accept: application/json\\"',
    '--H \\"OData-Version: 4.0\\"',
  ];
  if (withBody) parts.push('--H \\"Content-Type: application/json\\"');
  parts.push(`--H \\"Authorization: Basic " & ${AUTH_FN} & "\\"`);
  if (withBody) parts.push("--data @$body");
  parts.push("--location");
  parts.push("--dump-header $headerResponse");
  parts.push('"');
  return parts.join("\n");
}

// HTTP status of the final response. --location can produce several header
// blocks, so take the last "HTTP/" line. A status check catches 401/403/404
// with non-JSON bodies that an error.message check alone would miss.
const STATUS_CALC = `Let ( p = Position ( $headerResponse ; "HTTP/" ; Length ( $headerResponse ) ; -1 ) ; GetAsNumber ( Middle ( $headerResponse ; Position ( $headerResponse ; " " ; p ; 1 ) + 1 ; 3 ) ) )`;

const OK = `IsEmpty ( $err ) and not $skip`;

function httpCall(method, withBody, urlCalc, failPrefix) {
  return [
    S.setVar("$url", urlCalc),
    S.setVar("$curl", curlFor(method, withBody)),
    S.setVar("$headerResponse", `""`),
    S.insertFromURL("$url", "$curl", "$response"),
    S.setVar("$netError", "Get ( LastError )"),
    S.setVar("$status", STATUS_CALC),
    S.ifStep(`$netError ≠ 0`),
    S.setVar("$err", `"${failPrefix}: could not reach the server (error " & $netError & ")."`),
    S.elseStep(),
    S.ifStep(`$status < 200 or $status > 299`),
    S.setVar(
      "$err",
      `"${failPrefix}: server said " & $status & Case ( not IsEmpty ( JSONGetElement ( $response ; "error.message" ) ) and JSONGetElement ( $response ; "error.message" ) ≠ "?" ; " -- " & JSONGetElement ( $response ; "error.message" ) ; "" ) & "."${withBody ? ` & If ( $status = 400 ; " Sent: " & Left ( $body ; 800 ) ; "" )` : ""}`
    ),
    S.endIf(),
    S.endIf(),
  ];
}

function pass(cfg) {
  const T = cfg.to;
  const steps = [
    S.comment(""),
    S.banner(`${cfg.label} PASS`),
    S.setVar(
      "$pending",
      `ExecuteSQL ( "select \\"__ID\\" from \\"${T}\\" where \\"f_pendingSync\\" = 1" ; "" ; "" )`
    ),
    S.setVar("$i", "0"),
    S.loop(),
    S.setVar("$i", "$i + 1"),
    S.setVar("$rowID", `GetValue ( $pending ; $i )`),
    S.exitLoopIf(`IsEmpty ( $rowID )`),
    S.setVar("$skip", "False"),
    S.setVar("$err", `""`),
    S.setVar("$isConflict", "False"),
    S.setVar("$serverKey", `""`),
    S.setVar("$serverModified", `""`),
    S.comment(""),
    S.comment("Layout is set every iteration: a location create switches to"),
    S.comment("EquipmentSync to repoint children, and the next row must not inherit that."),
    S.goToLayout(cfg.layout.id, cfg.layout.name),
    S.findBy(T, "__ID", "$rowID"),
    S.ifStep(`Get ( LastError ) ≠ 0`),
    S.comment("Row vanished between the query and the find -- nothing to send."),
    S.setVar("$skip", "True"),
    S.endIf(),
    S.ifStep(OK),
    S.setVar("$action", `${T}::z_syncAction`),
    S.endIf(),
  ];

  if (cfg.parentKey) {
    steps.push(
      S.comment(""),
      S.comment("Equipment under a location that hasn't reached the server yet still"),
      S.comment("points at a negative local key. Sending it would orphan it on the server."),
      S.ifStep(`${OK} and $action ≠ "delete" and GetAsNumber ( ${T}::${cfg.parentKey} ) < 0`),
      S.setVar("$err", `"Its location hasn't been uploaded yet -- it will go on the next upload."`),
      S.endIf()
    );
  }

  steps.push(
    S.comment(""),
    S.banner(`${cfg.label}: FIND THE SERVER'S KEY`),
    S.comment("The device knows a row by __ID; OData addresses it by the server's"),
    S.comment("numeric key. The same GET returns zzModifiedTimestamp for the conflict check."),
    S.ifStep(`${OK} and $action ≠ "create"`),
    ...httpCall(
      "GET",
      false,
      `$base & "${cfg.entity}?$filter=__ID eq '" & ${T}::__ID & "'&$select=${cfg.serverKey},zzModifiedTimestamp"`,
      "Lookup failed"
    ),
    S.ifStep(`IsEmpty ( $err )`),
    S.setVar("$serverKey", `JSONGetElement ( $response ; "value[0]${cfg.serverKey}" )`),
    S.setVar(
      "$serverModified",
      `JSON.Types.GetTimestampFromISO ( $response ; "value[0]zzModifiedTimestamp" )`
    ),
    S.ifStep(`IsEmpty ( $serverKey ) or $serverKey = "?"`),
    S.setVar("$serverKey", `""`),
    ...(cfg.allowDelete
      ? [
          S.ifStep(`$action = "delete"`),
          S.comment("Already gone on the server. The local tombstone can go too."),
          S.elseStep(),
          S.setVar("$err", `"This record no longer exists on the server."`),
          S.endIf(),
        ]
      : [S.setVar("$err", `"This record no longer exists on the server."`)]),
    S.endIf(),
    S.endIf(),
    S.endIf(),
    S.comment(""),
    S.banner(`${cfg.label}: CONFLICT CHECK`),
    S.comment("z_serverModTimestamp is the server's timestamp as of download. If it has"),
    S.comment("moved, the office edited this row too. Leave both versions alone and say so."),
    S.ifStep(
      `${OK} and $action = "update" and not IsEmpty ( $serverModified ) and $serverModified ≠ "?" and not IsEmpty ( ${T}::z_serverModTimestamp ) and $serverModified ≠ ${T}::z_serverModTimestamp`
    ),
    S.setVar("$isConflict", "True"),
    S.setVar("$err", `"Changed in the office since this device downloaded it. Not uploaded."`),
    S.setVar(
      "$conflicts",
      `JSONSetElement ( $conflicts ; "[" & ValueCount ( JSONListKeys ( $conflicts ; "" ) ) & "]" ; JSONSetElement ( "{}" ; [ "table" ; "${cfg.label}" ; JSONString ] ; [ "__ID" ; ${T}::__ID ; JSONString ] ) ; JSONObject )`
    ),
    S.endIf(),
    S.comment(""),
    S.banner(`${cfg.label}: BUILD THE BODY`),
    S.ifStep(`${OK} and $action ≠ "delete"`),
    S.setVar("$body", `JSONSetElement ( "{}" ; [ "__ID" ; ${T}::__ID ; JSONString ] )`),
    S.ifStep(`$action = "create"`),
    ...cfg.createOnlyNumbers.map((f) =>
      S.setVar("$body", `JSONSetElement ( $body ; [ "${f}" ; ${T}::${f} ; JSONNumber ] )`)
    ),
    S.endIf(),
    S.comment("Text is sent even when empty, so clearing a note propagates."),
    ...cfg.text.map((f) =>
      S.setVar("$body", `JSONSetElement ( $body ; [ "${f}" ; ${T}::${f} ; JSONString ] )`)
    ),
    S.comment("Empty numbers are omitted: 0 would be a wrong measurement, not a blank one."),
    S.comment("GetAsNumber: a number field can hold typed text (\"23 1/2\"), which the"),
    S.comment("server rejects as 400 Incompatible types."),
    ...cfg.number.flatMap((f) => [
      S.ifStep(`not IsEmpty ( GetAsNumber ( ${T}::${f} ) )`),
      S.setVar("$body", `JSONSetElement ( $body ; [ "${f}" ; GetAsNumber ( ${T}::${f} ) ; JSONNumber ] )`),
      S.endIf(),
    ]),
    S.comment("Only a real date: a date field holding anything else formatted as"),
    S.comment("\"?-0-0\" and the server refused the whole row (400, iPad 2026-10-15)."),
    ...cfg.date.flatMap((f) => [
      S.ifStep(`not IsEmpty ( ${T}::${f} ) and IsValid ( ${T}::${f} ) and GetAsNumber ( Year ( ${T}::${f} ) ) > 0`),
      S.setVar(
        "$body",
        `JSONSetElement ( $body ; [ "${f}" ; ChangeDate_FM_to_JSON ( ${T}::${f} ) ; JSONString ] )`
      ),
      S.endIf(),
    ]),
    S.endIf(),
    S.comment(""),
    S.banner(`${cfg.label}: SEND`),
    S.ifStep(`${OK} and $action = "create"`),
    ...httpCall("POST", true, `$base & "${cfg.entity}"`, "Create failed"),
    S.endIf(),
    S.ifStep(`${OK} and $action = "update"`),
    ...httpCall("PATCH", true, `$base & "${cfg.entity}(" & $serverKey & ")"`, "Update failed"),
    S.endIf()
  );

  if (cfg.allowDelete) {
    steps.push(
      S.ifStep(`${OK} and $action = "delete" and not IsEmpty ( $serverKey )`),
      ...httpCall("DELETE", false, `$base & "${cfg.entity}(" & $serverKey & ")"`, "Delete failed"),
      S.endIf()
    );
  }

  steps.push(
    S.comment(""),
    S.banner(`${cfg.label}: RECORD THE OUTCOME`),
    S.ifStep(`not $skip`),
    S.ifStep(`IsEmpty ( $err )`)
  );

  if (cfg.allowDelete) {
    steps.push(
      S.ifStep(`$action = "delete"`),
      S.comment("The server has it (or never did). Remove the local tombstone."),
      S.deleteRecord(),
      S.elseStep()
    );
  }

  steps.push(
    S.ifStep(`$action = "create"`),
    S.setVar("$newKey", `JSONGetElement ( $response ; "${cfg.serverKey}" )`),
    S.ifStep(`not IsEmpty ( $newKey ) and $newKey ≠ "?"`),
    S.setVar("$oldKey", `${T}::${cfg.serverKey}`),
    S.setFieldByName(`"${T}::${cfg.serverKey}"`, "$newKey"),
    S.endIf(),
    S.endIf(),
    S.ifStep(`not IsEmpty ( JSONGetElement ( $response ; "zzModifiedTimestamp" ) ) and JSONGetElement ( $response ; "zzModifiedTimestamp" ) ≠ "?"`),
    S.setFieldByName(
      `"${T}::z_serverModTimestamp"`,
      `JSON.Types.GetTimestampFromISO ( $response ; "zzModifiedTimestamp" )`
    ),
    S.endIf(),
    S.setFieldByName(`"${T}::f_pendingSync"`, "0"),
    S.setFieldByName(`"${T}::z_syncAction"`, `""`),
    S.setFieldByName(`"${T}::z_syncError"`, `""`),
    S.commit()
  );

  if (cfg.label === "LOCATIONS") {
    steps.push(
      S.comment(""),
      S.comment("A location created in the field had a negative local key. Its equipment"),
      S.comment("still points at that key -- repoint it at the real one now, before the"),
      S.comment("equipment pass sends any of it."),
      S.ifStep(`$action = "create" and not IsEmpty ( $newKey ) and $newKey ≠ "?" and GetAsNumber ( $oldKey ) < 0`),
      S.setVar(
        "$kids",
        `ExecuteSQL ( "select \\"__ID\\" from \\"CUSTOMER_EQUIPMENT\\" where \\"_kf_Location\\" = ?" ; "" ; "" ; $oldKey )`
      ),
      S.goToLayout(7, "EquipmentSync"),
      S.setVar("$k", "0"),
      S.loop(),
      S.setVar("$k", "$k + 1"),
      S.setVar("$kidID", `GetValue ( $kids ; $k )`),
      S.exitLoopIf(`IsEmpty ( $kidID )`),
      S.findBy("CUSTOMER_EQUIPMENT", "__ID", "$kidID"),
      S.ifStep(`Get ( LastError ) = 0`),
      S.setFieldByName(`"CUSTOMER_EQUIPMENT::_kf_Location"`, "$newKey"),
      S.commit(),
      S.endIf(),
      S.endLoop(),
      S.endIf()
    );
  }

  if (cfg.allowDelete) steps.push(S.endIf()); // closes the delete / else
  steps.push(
    S.setVar("$uploaded", "$uploaded + 1"),
    S.elseStep(),
    S.setFieldByName(`"${T}::z_syncError"`, "$err"),
    S.commit(),
    S.ifStep(`not $isConflict`),
    S.setVar("$failed", "$failed + 1"),
    S.comment("Say why -- the count alone left the tech (and us) guessing."),
    S.setVar(
      "$failures",
      `JSONSetElement ( $failures ; "[" & ValueCount ( JSONListKeys ( $failures ; "" ) ) & "]" ; JSONSetElement ( "{}" ; [ "table" ; "${cfg.label}" ; JSONString ] ; [ "__ID" ; ${T}::__ID ; JSONString ] ; [ "label" ; ${T}::${cfg.label === "LOCATIONS" ? "Location_Name" : "Label_Number"} ; JSONString ] ; [ "error" ; $err ; JSONString ] ) ; JSONObject )`
    ),
    S.endIf(),
    S.endIf(),
    S.endIf(),
    S.endLoop()
  );
  return steps;
}

function build() {
  const steps = [
    S.comment("Description: Uploads pending location and equipment edits to the server."),
    S.comment("#################### #"),
    S.comment("Generated by scripts/generate-upload-changes.js -- edit that, not this."),
    S.comment("#################### #"),
    S.comment(""),
    S.banner("PARAMS"),
    S.setVar("$callbackName", `JSONGetElement ( Get ( ScriptParameter ) ; "callbackName" )`),
    S.setVar("$promiseID", `JSONGetElement ( Get ( ScriptParameter ) ; "promiseID" )`),
    S.setVar("$webviewer", `"${WEBVIEWER}"`),
    S.comment(""),
    S.banner("INITIALIZE"),
    S.setErrorCapture(true),
    S.comment("Work in a card so the Home layout and its web viewer never unload."),
    S.workWindow(PASSES[0].layout),
    S.allowUserAbort(false),
    S.setVar("$uploaded", "0"),
    S.setVar("$failed", "0"),
    S.setVar("$conflicts", `"[]"`),
    S.setVar("$failures", `"[]"`),
    S.setVar("$database", `Case ( inSandbox ; "GSR_Gaskets Rock_Sandbox" ; "GSR_Gaskets Rock" )`),
    S.setVar("$base", `${JSON.stringify(HOST)} & $database & "/"`),
    S.comment(""),
    S.banner("CREDENTIALS GUARD"),
    S.comment("Held as record data in the Credential table so it stays out of DDR"),
    S.comment("exports. A copy distributed without it should say so, not 401."),
    S.ifStep(`IsEmpty ( _ODataAuth ( ) )`),
    S.setVar(
      "$result",
      `JSONSetElement ( "{}" ; [ "error" ; "This copy has no server credentials. Nothing was uploaded -- ask the office for a configured copy." ; JSONString ] )`
    ),
    ...S.callBack(),
    S.exitScript("$result"),
    S.endIf(),
    S.comment(""),
    S.banner("ENVIRONMENT GUARD"),
    S.comment("inSandbox reflects the filename now; the data came down under the filename"),
    S.comment("then. Rename or duplicate a file holding pending edits and they would post"),
    S.comment("to the other database. Refuse rather than guess."),
    S.setVar("$downloadedFrom", `ExecuteSQL ( "select \\"DatabaseUUID\\" from \\"Sync_Settings\\"" ; "" ; "" )`),
    S.ifStep(`not IsEmpty ( $downloadedFrom ) and $downloadedFrom ≠ $database`),
    S.setVar(
      "$result",
      `JSONSetElement ( "{}" ; [ "error" ; "This device downloaded from " & $downloadedFrom & " but is now pointed at " & $database & ". Nothing was uploaded." ; JSONString ] )`
    ),
    ...S.callBack(),
    S.exitScript("$result"),
    S.endIf(),
    ...pass(PASSES[0]),
    ...pass(PASSES[1]),
    S.comment(""),
    S.banner("REPORT BACK"),
    S.setVar(
      "$result",
      `JSONSetElement ( "{}" ; [ "uploaded" ; $uploaded ; JSONNumber ] ; [ "failed" ; $failed ; JSONNumber ] ; [ "conflicts" ; $conflicts ; JSONArray ] ; [ "failures" ; $failures ; JSONArray ] )`
    ),
    ...S.callBack(),
    S.exitScript("$result"),
  ];
  return S.wrap(steps, { scriptName: "UploadChanges" });
}

const xml = build();
const outPath = path.join(__dirname, "..", "fmscripts", "UploadChanges.xml");
fs.writeFileSync(outPath, xml);
console.log(`\x1b[32mWrote ${path.relative(process.cwd(), outPath)}\x1b[0m`);

if (process.platform === "darwin") {
  const { spawn, exec } = require("child_process");
  const proc = spawn("pbcopy");
  proc.stdin.write(xml);
  proc.stdin.end();
  proc.on("close", () => {
    exec("osascript -e 'set the clipboard to (do shell script \"pbpaste\" as «class XMSC»)'", (error) => {
      if (error) return console.error(error);
      console.log("\x1b[32mCopied as a whole FileMaker script -- paste into the offline file's scripts list (rename the old one first).\x1b[0m");
    });
  });
}
