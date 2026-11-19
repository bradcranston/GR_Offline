// -----------------------------------------------------------------------
// Generates the real-data probe for the server build (option B).
// -----------------------------------------------------------------------
//   node ./scripts/generate-probe-route-equipment          (server script on clipboard)
//   node ./scripts/generate-probe-route-equipment device   (device script on clipboard)
//
// generate-probe-route-file.js proved the round trip with 99 Profiles whose
// text fields are empty. This sends one real route's equipment -- every
// field the offline file downloads -- to answer the two things that left open:
//
//   1. Size. Does a full route fit in an OData script result, and how long
//      do the export, the call and the import take?
//   2. Text. Do notes with line breaks and double quotes survive Merge
//      export and import byte for byte?
//
//   zProbe_RouteEquipment          GSR_Gaskets Rock_Sandbox. Takes
//                                  { account }; when empty, picks the account
//                                  with the most customers whose route has at
//                                  most CAP equipment rows. Finds the route's
//                                  active Locations (one request per customer),
//                                  Go to Related Record to its equipment,
//                                  exports it to Merge and returns it as
//                                  base64, plus a few notes containing line
//                                  breaks or quotes as known-good samples.
//   zProbe - Import Route          Offline SANDBOX copy. Calls it, imports the
//     Equipment                    rows into CUSTOMER_EQUIPMENT, checks each
//                                  sample note arrived exactly, then deletes
//                                  exactly the rows it added.
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
const S = require("./fmSteps");
const MAP = require("./routeEquipmentFields.json");

const HOST = "https://gr.cranstonhost.com/fmi/odata/v4/";
const SANDBOX_DB = "GSR_Gaskets Rock_Sandbox";
const SERVER_SCRIPT = "zProbe_RouteEquipment";
const DEVICE_SCRIPT = "zProbe - Import Route Equipment";
const CAP = 30000; // the offline sandbox holds ~11,000 rows for a 579-location route
const MAX_TRIES = 8;

// Server (DDRs/20261005): layout 34 "List - Locations" on customers__LOCATIONS,
// related to customers_locations__CUSTOMERS_EQUIPMENT on
// __kp_Location = _kf_Location; layout 6 "List - Equipment" shows the latter.
const LOC_LAYOUT = { id: 34, name: "List - Locations" };
const LOC_TO = "customers__LOCATIONS";
const EQ_LAYOUT = { id: 6, name: "List - Equipment" };
const EQ_TO = { name: MAP.serverTable.name };
const SERVER_FIELDS = MAP.fields.map((f) => ({ table: EQ_TO.name, id: f.server, name: f.name }));

// Device (DDRs/20261009): layout 7 EquipmentSync, TO CUSTOMER_EQUIPMENT.
const DEVICE_LAYOUT = { id: 7, name: "EquipmentSync" };
const DEVICE_TABLE = MAP.offlineTable;
const DEVICE_FIELDS = MAP.fields.map((f) => ({ id: f.offline, name: f.name }));
// Real id (DDR 2026-10-15): run 3's Insert from URL used id 0 and FileMaker did
// not resolve it by name on paste -- error 102 "field missing". Export Field
// Contents did resolve. Use the id for both.
const ROUTE_FIELD = { table: "Sync_Settings", id: 36, name: "zg_RouteFile" };
// Server (DDRs/20261015 11:10): table RouteExports, layout 353. Run 2 showed an
// OData script result is cut at ~1,000,000 characters (code 736), so the file
// is stored here and the device downloads the container's $value by key.
const EXPORT_LAYOUT = { id: 353, name: "RouteExports" };

const STATUS_CALC = `Let ( p = Position ( $headerResponse ; "HTTP/" ; Length ( $headerResponse ) ; -1 ) ; GetAsNumber ( Middle ( $headerResponse ; Position ( $headerResponse ; " " ; p ; 1 ) + 1 ; 3 ) ) )`;
const NOW = "Get ( CurrentTimeUTCMilliseconds )";


const script = (name, steps) =>
  `<Script includeInMenu="True" SiriShortcutVisible="False" runFullAccess="False" id="0" name="${name}">\n${steps.join(
    "\n"
  )}\n</Script>`;
const snippet = (scripts) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">\n${scripts.join(
    "\n"
  )}\n</fmxmlsnippet>`;

// "12, 34" (possibly quoted) -> "12,34". Digits and commas only, so it is safe
// to splice into SQL; empty items removed.
const SANITISE = (expr) =>
  `Let ( [ a = Filter ( ${expr} ; "0123456789," ) ; b = Substitute ( "," & a & "," ; [ ",,," ; "," ] ; [ ",," ; "," ] ) ] ; Middle ( b ; 2 ; Length ( b ) - 2 ) )`;

// Run 1 (2026-10-09): the call waited 603 s and nginx returned 502. The cause
// was SQL: "count(*) ... where _kf_Location in (select ...)" against 669,530
// equipment rows, once per candidate account, plus LIKE queries for samples.
// FileMaker SQL handles IN (subquery) badly on big tables. Run 2 uses only
// indexed finds and Go to Related Record, reads samples with GetNthRecord,
// and stops itself at TIME_BUDGET_MS, well inside the proxy's ~600 s.
const TIME_BUDGET_MS = 300000;
const SAMPLE_SCAN = 20000; // rows scanned for sample notes at most

function serverScript() {
  const elapsed = `( ${NOW} - $t0 )`;
  return script(SERVER_SCRIPT, [
    S.comment("Real-data probe for the server build, called over OData. Safe to delete."),
    S.comment("Generated by scripts/generate-probe-route-equipment.js."),
    S.comment("No SQL against the big tables: finds and Go to Related Record only."),
    S.setErrorCapture(true),
    S.allowUserAbort(false),
    S.setVar("$t0", NOW),
    S.setVar("$account", `Let ( a = JSONGetElement ( Get ( ScriptParameter ) ; "account" ) ; If ( Left ( a ; 1 ) = "?" ; "" ; a ) )`),
    S.setVar("$tried", `"[]"`),
    S.setVar("$triedNames", `""`),
    S.setVar("$chosen", `""`),
    S.comment(""),
    S.banner("CANDIDATES: USERS AND THEIR CUSTOMER LISTS (267 ROWS, CHEAP)"),
    S.setVar(
      "$users",
      `ExecuteSQL ( "select \\"Account_Name\\", \\"CustomersAssigned\\" from \\"USERS\\" where \\"CustomersAssigned\\" is not null" ; Char ( 9 ) ; ¶ )`
    ),
    S.setVar("$usersMs", elapsed),
    S.setVar("$try", "0"),
    S.loop(),
    S.setVar("$try", "$try + 1"),
    S.exitLoopIf(`not IsEmpty ( $chosen ) or $try > ${MAX_TRIES} or ${elapsed} > ${TIME_BUDGET_MS}`),
    S.comment("Named account: that one only. Otherwise the most customers not yet tried."),
    S.ifStep("not IsEmpty ( $account )"),
    S.exitLoopIf("$try > 1"),
    S.setVar("$candidate", "$account"),
    S.setVar(
      "$customers",
      `ExecuteSQL ( "select \\"CustomersAssigned\\" from \\"USERS\\" where \\"Account_Name\\" = ?" ; "" ; "" ; $account )`
    ),
    S.elseStep(),
    S.setVar("$candidate", `""`),
    S.setVar("$best", "0"),
    S.setVar("$u", "0"),
    S.loop(),
    S.setVar("$u", "$u + 1"),
    S.setVar("$row", `GetValue ( $users ; $u )`),
    S.exitLoopIf("IsEmpty ( $row )"),
    S.setVar("$name", `Let ( p = Position ( $row ; Char ( 9 ) ; 1 ; 1 ) ; Left ( $row ; p - 1 ) )`),
    S.setVar("$list", `Let ( p = Position ( $row ; Char ( 9 ) ; 1 ; 1 ) ; Middle ( $row ; p + 1 ; Length ( $row ) ) )`),
    S.setVar("$n", `Let ( s = ${SANITISE("$list")} ; If ( IsEmpty ( s ) ; 0 ; PatternCount ( s ; "," ) + 1 ) )`),
    S.ifStep(`$n > $best and IsEmpty ( FilterValues ( $name ; $triedNames ) )`),
    S.setVar("$best", "$n"),
    S.setVar("$candidate", "$name"),
    S.setVar("$customers", "$list"),
    S.endIf(),
    S.endLoop(),
    S.endIf(),
    S.exitLoopIf("IsEmpty ( $candidate )"),
    S.setVar("$triedNames", "List ( $triedNames ; $candidate )"),
    S.setVar("$ids", SANITISE("$customers")),
    S.comment(""),
    S.comment("Find the route: one request per customer, active locations only."),
    S.setVar("$tf", NOW),
    S.goToLayout(LOC_LAYOUT.id, LOC_LAYOUT.name),
    S.enterFindMode(),
    S.setVar("$k", "0"),
    S.loop(),
    S.setVar("$k", "$k + 1"),
    S.setVar("$cust", `GetValue ( Substitute ( $ids ; "," ; ¶ ) ; $k )`),
    S.exitLoopIf("IsEmpty ( $cust )"),
    S.ifStep("$k > 1"),
    S.newRecord(),
    S.endIf(),
    S.setFieldByName(`"${LOC_TO}::_kf_Customer"`, "$cust"),
    S.setFieldByName(`"${LOC_TO}::f_isActive"`, "1"),
    S.endLoop(),
    S.performFindCurrent(),
    S.setVar("$findError", "Get ( LastError )"),
    S.setVar("$locFound", "If ( $findError = 0 ; Get ( FoundCount ) ; 0 )"),
    S.setVar("$gtrrError", `""`),
    S.setVar("$eqFound", "0"),
    S.ifStep("$locFound > 0"),
    S.goToRelatedRecord(EQ_TO, EQ_LAYOUT),
    S.setVar("$gtrrError", "Get ( LastError )"),
    S.comment("A failed Go to Related Record leaves the locations as the found set."),
    S.setVar("$eqFound", "If ( $gtrrError = 0 ; Get ( FoundCount ) ; 0 )"),
    S.endIf(),
    S.setVar(
      "$tried",
      `JSONSetElement ( $tried ; "[" & ValueCount ( JSONListKeys ( $tried ; "" ) ) & "]" ; JSONSetElement ( "{}" ; [ "account" ; $candidate ; JSONString ] ; [ "customers" ; If ( IsEmpty ( $ids ) ; 0 ; PatternCount ( $ids ; "," ) + 1 ) ; JSONNumber ] ; [ "locations" ; $locFound ; JSONNumber ] ; [ "equipment" ; $eqFound ; JSONNumber ] ; [ "findError" ; $findError ; JSONNumber ] ; [ "gtrrError" ; $gtrrError ; JSONString ] ; [ "ms" ; ${NOW} - $tf ; JSONNumber ] ) ; JSONObject )`
    ),
    S.ifStep(`$eqFound > 0 and $eqFound ≤ ${CAP}`),
    S.setVar("$chosen", "$candidate"),
    S.endIf(),
    S.endLoop(),
    S.comment(""),
    S.ifStep("IsEmpty ( $chosen )"),
    S.exitScript(
      `JSONSetElement ( "{}" ; [ "error" ; If ( ${elapsed} > ${TIME_BUDGET_MS} ; "Stopped at the time limit while choosing a route." ; "No account with a route of 1 to ${CAP} equipment rows among those tried." ) ; JSONString ] ; [ "tried" ; $tried ; JSONArray ] ; [ "usersMs" ; $usersMs ; JSONNumber ] ; [ "totalMs" ; ${elapsed} ; JSONNumber ] )`
    ),
    S.endIf(),
    S.comment("The found set is now the chosen route's equipment, on the equipment layout."),
    S.comment(""),
    S.banner("EXPORT AND READ"),
    S.setVar("$t2", NOW),
    S.setVar("$path", `Get ( TemporaryPath ) & "route_equipment.mer"`),
    S.exportRecords("$path", SERVER_FIELDS, "MRGE"),
    S.setVar("$exportError", "Get ( LastError )"),
    S.setVar("$exportMs", `${NOW} - $t2`),
    S.setVar("$native", `MBS ( "Path.FileMakerPathToNativePath" ; $path )`),
    S.setVar("$file", `MBS ( "Container.ReadFile" ; $native )`),
    S.setVar("$readError", `If ( PatternCount ( GetAsText ( $file ) ; "[MBS]" ) ; GetAsText ( $file ) ; "" )`),
    S.setVar("$cleanup", `MBS ( "Files.Delete" ; $native )`),
    S.comment(""),
    S.banner("SAMPLES FROM THE FOUND SET: NOTES WITH LINE BREAKS, NOTES WITH QUOTES"),
    S.comment("GetNthRecord reads the found set without moving between records."),
    S.setVar("$t4", NOW),
    S.setVar("$samples", `"[]"`),
    S.setVar("$withBreak", "0"),
    S.setVar("$withQuote", "0"),
    S.setVar("$r", "0"),
    S.loop(),
    S.setVar("$r", "$r + 1"),
    S.exitLoopIf(
      `$r > Get ( FoundCount ) or $r > ${SAMPLE_SCAN} or ( $withBreak ≥ 2 and $withQuote ≥ 2 ) or ${elapsed} > ${TIME_BUDGET_MS}`
    ),
    S.setVar("$note", `GetNthRecord ( ${EQ_TO.name}::Item_Note ; $r )`),
    S.setVar("$isBreak", `PatternCount ( $note ; Char ( 13 ) ) > 0 and $withBreak < 2`),
    S.setVar("$isQuote", `PatternCount ( $note ; Char ( 34 ) ) > 0 and $withQuote < 2 and not $isBreak`),
    S.ifStep("$isBreak or $isQuote"),
    S.setVar(
      "$samples",
      `JSONSetElement ( $samples ; "[" & ValueCount ( JSONListKeys ( $samples ; "" ) ) & "]" ; JSONSetElement ( "{}" ; [ "__ID" ; GetNthRecord ( ${EQ_TO.name}::__ID ; $r ) ; JSONString ] ; [ "Item_Note" ; $note ; JSONString ] ) ; JSONObject )`
    ),
    S.setVar("$withBreak", "$withBreak + If ( $isBreak ; 1 ; 0 )"),
    S.setVar("$withQuote", "$withQuote + If ( $isQuote ; 1 ; 0 )"),
    S.endIf(),
    S.endLoop(),
    S.setVar("$sampleMs", `${NOW} - $t4`),
    S.comment(""),
    S.banner("STORE THE FILE FOR THE DEVICE TO DOWNLOAD"),
    S.comment("After the samples: going to this layout leaves the equipment found set."),
    S.setVar("$t5", NOW),
    S.setVar("$key", `""`),
    S.ifStep("IsEmpty ( $readError )"),
    S.goToLayout(EXPORT_LAYOUT.id, EXPORT_LAYOUT.name),
    S.newRecord(),
    S.setFieldByName(`"${EXPORT_LAYOUT.name}::Account"`, "$chosen"),
    S.setFieldByName(`"${EXPORT_LAYOUT.name}::BuiltAt"`, "Get ( CurrentTimestamp )"),
    S.comment("Stored as base64 TEXT in a utf-8 file. Runs 5-6: the device's Insert from URL"),
    S.comment("decodes a downloaded UTF-16 file into text and it could not be turned back"),
    S.comment("into an importable file. Base64 is ASCII, so the text arrives exactly and"),
    S.comment("Base64Decode rebuilds the Merge file -- the path the Profiles probe proved on"),
    S.comment("FileMaker Go."),
    S.setVar("$t6", NOW),
    S.setVar("$b64", "Base64EncodeRFC ( 4648 ; $file )"),
    S.setVar("$encodeMs", `${NOW} - $t6`),
    S.setFieldByName(`"${EXPORT_LAYOUT.name}::File"`, `TextEncode ( $b64 ; "utf-8" ; 1 )`),
    S.commit(),
    S.setVar("$saveError", "Get ( LastError )"),
    S.setVar("$key", `${EXPORT_LAYOUT.name}::__kp_RouteExport`),
    S.setVar("$storedSize", `GetContainerAttribute ( ${EXPORT_LAYOUT.name}::File ; "filesize" )`),
    S.setVar("$b64Length", "Length ( $b64 )"),
    S.setVar("$b64", `""`),
    S.endIf(),
    S.setVar("$saveMs", `${NOW} - $t5`),
    S.comment(""),
    S.exitScript(
      `JSONSetElement ( "{}" ;
  [ "account" ; $chosen ; JSONString ] ;
  [ "tried" ; $tried ; JSONArray ] ;
  [ "equipmentFound" ; $eqFound ; JSONNumber ] ;
  [ "exportError" ; $exportError ; JSONNumber ] ;
  [ "readError" ; $readError ; JSONString ] ;
  [ "fileSize" ; GetContainerAttribute ( $file ; "filesize" ) ; JSONNumber ] ;
  [ "usersMs" ; $usersMs ; JSONNumber ] ;
  [ "exportMs" ; $exportMs ; JSONNumber ] ;
  [ "sampleMs" ; $sampleMs ; JSONNumber ] ;
  [ "saveError" ; $saveError ; JSONString ] ;
  [ "encodeMs" ; $encodeMs ; JSONNumber ] ;
  [ "base64Length" ; $b64Length ; JSONNumber ] ;
  [ "storedSize" ; $storedSize ; JSONString ] ;
  [ "saveMs" ; $saveMs ; JSONNumber ] ;
  [ "key" ; $key ; JSONString ] ;
  [ "rowsScanned" ; $r - 1 ; JSONNumber ] ;
  [ "totalMs" ; ${elapsed} ; JSONNumber ] ;
  [ "samples" ; $samples ; JSONArray ]
)`
    ),
  ]);
}

function deviceScript() {
  return script(DEVICE_SCRIPT, [
    S.comment("Real-data probe for the server build. Offline SANDBOX copy only. Safe to delete."),
    S.comment("Generated by scripts/generate-probe-route-equipment.js."),
    S.comment("Optional script parameter: an account name. Empty lets the server pick the biggest route."),
    S.setErrorCapture(true),
    S.allowUserAbort(false),
    S.ifStep("not inSandbox"),
    S.showCustomDialog(`"Sandbox only"`, `Get ( FileName ) & " is not a Sandbox copy."`),
    S.exitScript(`""`),
    S.endIf(),
    S.ifStep("IsEmpty ( _ODataAuth ( ) )"),
    S.showCustomDialog(`"No credentials"`, `"This copy has no odata row in Credential."`),
    S.exitScript(`""`),
    S.endIf(),
    S.comment(""),
    S.banner("1. CALL THE SERVER"),
    S.setVar("$base", JSON.stringify(HOST + SANDBOX_DB + "/")),
    S.setVar("$url", JSON.stringify(HOST + SANDBOX_DB + "/Script." + SERVER_SCRIPT)),
    S.setVar(
      "$body",
      `JSONSetElement ( "{}" ; "scriptParameterValue" ; JSONSetElement ( "{}" ; "account" ; Get ( ScriptParameter ) ; JSONString ) ; JSONString )`
    ),
    S.setVar(
      "$curl",
      [
        '"--X POST',
        '--H \\"Accept: application/json\\"',
        '--H \\"OData-Version: 4.0\\"',
        '--H \\"Content-Type: application/json\\"',
        '--H \\"Authorization: Basic " & _ODataAuth ( ) & "\\"',
        "--data @$body",
        "--dump-header $headerResponse",
        '"',
      ].join("\n")
    ),
    S.setVar("$headerResponse", `""`),
    S.setVar("$t0", NOW),
    S.insertFromURL("$url", "$curl", "$response"),
    S.setVar("$netError", "Get ( LastError )"),
    S.setVar("$callMs", `${NOW} - $t0`),
    S.setVar("$status", STATUS_CALC),
    S.setVar("$result", `JSONGetElement ( $response ; "scriptResult.resultParameter" )`),
    S.setVar("$key", `JSONGetElement ( $result ; "key" )`),
    S.setVar(
      "$callFailed",
      `$netError ≠ 0 or $status < 200 or $status > 299 or IsEmpty ( $key ) or Left ( $key ; 1 ) = "?" or GetAsNumber ( $key ) = 0`
    ),
    S.setVar("$samples", `If ( $callFailed ; "[]" ; JSONGetElement ( $result ; "samples" ) )`),
    S.setVar("$checks", `"[]"`),
    S.setVar("$preCounts", `"[]"`),
    S.comment(""),
    S.ifStep("$callFailed"),
    S.setVar("$stage", `"server call failed -- see httpStatus and rawResponse"`),
    S.elseStep(),
    S.comment(""),
    S.banner("2. HOW MANY COPIES OF EACH SAMPLE EXIST BEFORE THE IMPORT"),
    S.comment("Afterwards there must be exactly one more of each -- the imported row --"),
    S.comment("or the note changed on the way."),
    S.setVar("$s", "0"),
    S.loop(),
    S.setVar("$sid", `JSONGetElement ( $samples ; "[" & $s & "]__ID" )`),
    S.exitLoopIf(`IsEmpty ( $sid ) or Left ( $sid ; 1 ) = "?"`),
    S.setVar("$note", `JSONGetElement ( $samples ; "[" & $s & "]Item_Note" )`),
    S.setVar(
      "$preCounts",
      `JSONSetElement ( $preCounts ; "[" & $s & "]" ; GetAsNumber ( ExecuteSQL ( "select count(*) from \\"CUSTOMER_EQUIPMENT\\" where \\"__ID\\" = ? and \\"Item_Note\\" = ?" ; "" ; "" ; $sid ; $note ) ) ; JSONNumber )`
    ),
    S.setVar("$s", "$s + 1"),
    S.endLoop(),
    S.comment(""),
    S.banner("3. DOWNLOAD THE CONTAINER, WRITE IT TO TEMP, IMPORT"),
    S.comment("Binary download of the stored file: no base64, no script-result limit."),
    S.setVar("$fileUrl", `$base & "RouteExports(" & $key & ")/File/$value"`),
    S.setVar(
      "$getCurl",
      [
        '"--X GET',
        '--H \\"OData-Version: 4.0\\"',
        '--H \\"Authorization: Basic " & _ODataAuth ( ) & "\\"',
        "--dump-header $headerResponse",
        '"',
      ].join("\n")
    ),
    S.comment("Runs 3-4: Insert from URL straight into the field returned 102 in 0 ms."),
    S.comment("Attempt 1 downloads into a variable (no field reference, no layout) and"),
    S.comment("Set Field moves it into the container. Attempt 2, only if the variable did"),
    S.comment("not get a file, is the field target again on the Sync_Settings layout."),
    S.setVar("$headerResponse", `""`),
    S.setVar("$t1", NOW),
    S.setVar("$layoutAtDownload", "Get ( LayoutName )"),
    S.insertFromURL("$fileUrl", "$getCurl", "$fileData"),
    S.setVar("$downloadError", "Get ( LastError )"),
    S.setVar("$downloadStatus", STATUS_CALC),
    S.setVar("$varSize", `GetContainerAttribute ( $fileData ; "filesize" )`),
    S.setVar("$varTextLength", "Length ( $fileData )"),
    S.comment("The server stores the file as base64 text, which arrives in the variable"),
    S.comment("exactly; Base64Decode rebuilds the Merge file (the path the Profiles probe"),
    S.comment("proved on FileMaker Go)."),
    S.setVar("$attempt", `"base64 text + Base64Decode"`),
    S.setVar("$b64Received", "Length ( $fileData )"),
    S.setFieldByName(
      `"${ROUTE_FIELD.table}::${ROUTE_FIELD.name}"`,
      `Base64Decode ( $fileData ; "route_equipment.mer" )`
    ),
    S.setVar("$setError", "Get ( LastError )"),
    S.setVar("$encodedSize", `GetContainerAttribute ( ${ROUTE_FIELD.table}::${ROUTE_FIELD.name} ; "filesize" )`),
    S.setVar("$fileData", `""`),
    S.setVar("$downloadMs", `${NOW} - $t1`),
    S.setVar("$downloadSize", `GetContainerAttribute ( ${ROUTE_FIELD.table}::${ROUTE_FIELD.name} ; "filesize" )`),
    S.setVar("$path", `Get ( TemporaryPath ) & "route_equipment.mer"`),
    S.exportFieldContents(ROUTE_FIELD, "$path"),
    S.setVar("$exportError", "Get ( LastError )"),
    S.goToLayout(DEVICE_LAYOUT.id, DEVICE_LAYOUT.name),
    S.setVar("$before", "Get ( TotalRecordCount )"),
    S.setVar("$t2", NOW),
    S.importRecordsMerge("$path", DEVICE_TABLE, DEVICE_FIELDS, "Add"),
    S.setVar("$importError", "Get ( LastError )"),
    S.setVar("$importMs", `${NOW} - $t2`),
    S.setVar("$imported", "Get ( FoundCount )"),
    S.setVar("$after", "Get ( TotalRecordCount )"),
    S.comment(""),
    S.banner("4. DID EACH SAMPLE ARRIVE EXACTLY?"),
    S.setVar("$s", "0"),
    S.loop(),
    S.setVar("$sid", `JSONGetElement ( $samples ; "[" & $s & "]__ID" )`),
    S.exitLoopIf(`IsEmpty ( $sid ) or Left ( $sid ; 1 ) = "?"`),
    S.setVar("$note", `JSONGetElement ( $samples ; "[" & $s & "]Item_Note" )`),
    S.setVar(
      "$post",
      `ExecuteSQL ( "select count(*) from \\"CUSTOMER_EQUIPMENT\\" where \\"__ID\\" = ? and \\"Item_Note\\" = ?" ; "" ; "" ; $sid ; $note )`
    ),
    S.setVar(
      "$checks",
      `JSONSetElement ( $checks ; "[" & $s & "]" ; JSONSetElement ( "{}" ; [ "__ID" ; $sid ; JSONString ] ; [ "hasLineBreak" ; PatternCount ( $note ; Char ( 13 ) ) > 0 ; JSONBoolean ] ; [ "hasQuote" ; PatternCount ( $note ; Char ( 34 ) ) > 0 ; JSONBoolean ] ; [ "length" ; Length ( $note ) ; JSONNumber ] ; [ "exact" ; GetAsNumber ( $post ) - GetAsNumber ( JSONGetElement ( $preCounts ; "[" & $s & "]" ) ) = 1 ; JSONBoolean ] ) ; JSONObject )`
    ),
    S.setVar("$s", "$s + 1"),
    S.endLoop(),
    S.comment(""),
    S.banner("5. REMOVE EXACTLY WHAT WAS ADDED"),
    S.setVar("$t3", NOW),
    S.ifStep(`$importError = 0 and $imported > 0 and $after = $before + $imported`),
    S.deleteAllRecords(),
    S.setVar("$cleanup", `"removed the " & $imported & " imported rows; " & Get ( TotalRecordCount ) & " left"`),
    S.elseStep(),
    S.setVar("$cleanup", `"nothing deleted -- counts did not line up"`),
    S.endIf(),
    S.setVar("$deleteMs", `${NOW} - $t3`),
    S.setFieldByName(`"${ROUTE_FIELD.table}::${ROUTE_FIELD.name}"`, `""`),
    S.comment(""),
    S.banner("6. DELETE THE SERVER'S COPY"),
    S.setVar(
      "$delCurl",
      [
        '"--X DELETE',
        '--H \\"OData-Version: 4.0\\"',
        '--H \\"Authorization: Basic " & _ODataAuth ( ) & "\\"',
        "--dump-header $headerResponse",
        '"',
      ].join("\n")
    ),
    S.setVar("$headerResponse", `""`),
    S.setVar("$delUrl", `$base & "RouteExports(" & $key & ")"`),
    S.insertFromURL("$delUrl", "$delCurl", "$delResponse"),
    S.setVar("$serverDeleteStatus", STATUS_CALC),
    S.setVar("$stage", `"done"`),
    S.endIf(),
    S.comment(""),
    S.setVar(
      "$report",
      `JSONSetElement ( "{}" ;
  [ "stage" ; $stage ; JSONString ] ;
  [ "device" ; Get ( ApplicationVersion ) ; JSONString ] ;
  [ "httpStatus" ; $status ; JSONNumber ] ;
  [ "callMs" ; $callMs ; JSONNumber ] ;
  [ "responseChars" ; Length ( $response ) ; JSONNumber ] ;
  [ "server" ; If ( $callFailed ; "" ; JSONDeleteElement ( $result ; "samples" ) ) ; JSONString ] ;
  [ "downloadStatus" ; $downloadStatus ; JSONString ] ;
  [ "downloadError" ; $downloadError ; JSONString ] ;
  [ "downloadAttempt" ; $attempt ; JSONString ] ;
  [ "layoutAtDownload" ; $layoutAtDownload ; JSONString ] ;
  [ "variableTextLength" ; $varTextLength ; JSONString ] ;
  [ "setFieldError" ; $setError ; JSONString ] ;
  [ "base64Received" ; $b64Received ; JSONString ] ;
  [ "decodedFileSize" ; $encodedSize ; JSONString ] ;
  [ "downloadMs" ; $downloadMs ; JSONString ] ;
  [ "downloadSize" ; $downloadSize ; JSONString ] ;
  [ "exportError" ; $exportError ; JSONString ] ;
  [ "importError" ; $importError ; JSONString ] ;
  [ "importMs" ; $importMs ; JSONString ] ;
  [ "before" ; $before ; JSONString ] ;
  [ "imported" ; $imported ; JSONString ] ;
  [ "after" ; $after ; JSONString ] ;
  [ "noteChecks" ; $checks ; JSONArray ] ;
  [ "cleanup" ; $cleanup ; JSONString ] ;
  [ "deleteMs" ; $deleteMs ; JSONString ] ;
  [ "serverDeleteStatus" ; $serverDeleteStatus ; JSONString ] ;
  [ "rawResponse" ; If ( $callFailed ; Left ( $response ; 400 ) ; "" ) ; JSONString ]
)`
    ),
    S.showCustomDialog(`"Route equipment probe"`, `JSONFormatElements ( $report )`),
    S.exitScript("$report"),
  ]);
}

const outputs = {
  server: { file: "ProbeRouteEquipment_Server.xml", xml: snippet([serverScript()]), where: "GSR_Gaskets Rock_Sandbox" },
  device: { file: "ProbeRouteEquipment_Device.xml", xml: snippet([deviceScript()]), where: "GasketsRockOffline_Sandbox" },
};
for (const o of Object.values(outputs)) {
  const p = path.join(__dirname, "..", "fmscripts", o.file);
  fs.writeFileSync(p, o.xml);
  console.log(`\x1b[32mWrote ${path.relative(process.cwd(), p)}\x1b[0m`);
}

const pick = outputs[process.argv[2] === "device" ? "device" : "server"];
if (process.platform === "darwin") {
  const proc = spawn("pbcopy");
  proc.stdin.write(pick.xml);
  proc.stdin.end();
  proc.on("close", () => {
    exec(
      "osascript -e 'set the clipboard to (do shell script \"pbpaste\" as «class XMSC»)'",
      (error) => {
        if (error) return console.error(error);
        console.log(`\x1b[32mCopied ${pick.file} -- paste into the scripts list of ${pick.where}.\x1b[0m`);
      }
    );
  });
}
