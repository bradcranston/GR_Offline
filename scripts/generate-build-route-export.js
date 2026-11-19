// -----------------------------------------------------------------------
// Generates "Build Route Export" -- the server half of the route install.
// -----------------------------------------------------------------------
//   node ./scripts/generate-build-route-export
//
// Lives in GSR_Gaskets Rock(_Sandbox). The offline file calls it over the
// OData script endpoint with { account } and gets back keys, not data:
//
//   { account, customers: [ { __kp_Customer, Customer_Name } ],
//     tables: { LOCATIONS: { key, rows, ms }, CONTACT_JOINS: { ... }, ... },
//     (keys are the labels with spaces as underscores, so JSON paths stay simple)
//     totalMs }
//   or { error }
//
// Each table goes out as its own RouteExports record: the found set exported
// to Merge, base64-encoded, stored as a utf-8 text file in RouteExports::File.
// The device downloads RouteExports(<key>)/File/$value, Base64Decodes it and
// imports it by field name, then deletes the record. Every part of that was
// proven on FileMaker Go by the zProbe scripts (fmscripts/SERVER_BUILD_DESIGN.md):
//   - an OData script result is cut at ~1 MB, so files never travel in it;
//   - a downloaded UTF-16 file arrives as text, so it travels as base64;
//   - ExecuteSQL IN (subquery) on the big tables took >10 minutes, so routes
//     are found with indexed finds and Go to Related Record only.
//
// Which records, mirroring Initial Download's TABLES config:
//   LOCATIONS        active, _kf_Customer in the account's CustomersAssigned
//   EQUIPMENT        related to those locations (Go to Related Record)
//   PROFILES         active, ProfileType "Gaskets"
//   MANUFACTURERS    all
//   CONTACT JOINS    _kf_Location in the locations, parentType "Location"
//   CONTACTS         __ID in the joins' _ID_Contact
//   CONTACT METHODS  _ID_Contact in those contacts
//   ADDRESSES        _ID in the locations' three address ids
// No relationship from the locations reaches the last four with a layout on
// the far side, so they are finds built one request per key. Keys are
// collected from each found set with GetNthRecord before moving on.
//
// Runs with full access: the scoped offline_field_app account then needs
// only Executable on this one script, not layout, export and record rights
// on eight tables. Anyone who can call it can ask for any account's route --
// no wider than the shared OData account already reads (ODATA_ACCOUNT.md).
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
const S = require("./fmSteps");
const MAP = require("./routeTables.json");

const SCRIPT = "Build Route Export";
const TIME_BUDGET_MS = 300000; // well inside the ~600 s nginx gives an OData call
const EXPORTS = { layout: { id: 353, name: "RouteExports" }, to: "RouteExports" };
const NOW = "Get ( CurrentTimeUTCMilliseconds )";
const ELAPSED = `( ${NOW} - $t0 )`;

const T = Object.fromEntries(MAP.tables.map((t) => [t.label, t]));
const v = (label) => label.replace(/\W+/g, "_"); // LOCATIONS -> LOCATIONS, CONTACT JOINS -> CONTACT_JOINS

// "12, 34" (possibly quoted) -> "12,34": digits and commas only, empties dropped.
const SANITISE = (expr) =>
  `Let ( [ a = Filter ( ${expr} ; "0123456789," ) ; b = Substitute ( "," & a & "," ; [ ",,," ; "," ] ; [ ",," ; "," ] ) ] ; Middle ( b ; 2 ; Length ( b ) - 2 ) )`;

const fail = (messageCalc) => [
  S.exitScript(`JSONSetElement ( "{}" ; [ "error" ; ${messageCalc} ; JSONString ] ; [ "totalMs" ; ${ELAPSED} ; JSONNumber ] )`),
];

const budgetCheck = (label) => [
  S.ifStep(`${ELAPSED} > ${TIME_BUDGET_MS}`),
  ...fail(`"The route for " & $account & " is too large to prepare in one go (stopped before ${label.toLowerCase()} after " & Round ( ${ELAPSED} / 1000 ; 0 ) & " s). Ask the office."`),
  S.endIf(),
];

// Find on the current layout: one request per value in a ¶-list.
// setters: [ [ fieldName, calcUsing$val ], ... ] applied to every request.
function findEach(to, listVar, setters, findErrorVar) {
  return [
    S.enterFindMode(),
    S.setVar("$k", "0"),
    S.loop(),
    S.setVar("$k", "$k + 1"),
    S.setVar("$val", `GetValue ( ${listVar} ; $k )`),
    S.exitLoopIf("IsEmpty ( $val )"),
    S.ifStep("$k > 1"),
    S.newRecord(),
    S.endIf(),
    ...setters.map(([field, calc]) => S.setFieldByName(`"${to}::${field}"`, calc)),
    S.endLoop(),
    S.performFindCurrent(),
    S.setVar(findErrorVar, "Get ( LastError )"),
  ];
}

// Export the current found set of a table and hold it, base64, in $file_<X>.
// Only runs when the find that produced the found set succeeded: after a
// failed find the old found set is still there, and exporting it would ship
// the wrong records.
function exportTable(label, okCalc) {
  const t = T[label];
  const x = v(label);
  const fields = t.fields.map((f) => ({ table: t.server.to, id: f.server, name: f.name }));
  return [
    S.setVar(`$rows_${x}`, "0"),
    S.setVar(`$b64_${x}`, `""`),
    S.ifStep(`${okCalc} and Get ( FoundCount ) > 0`),
    S.setVar(`$rows_${x}`, "Get ( FoundCount )"),
    S.setVar("$path", `Get ( TemporaryPath ) & "route_${x.toLowerCase()}.mer"`),
    S.exportRecords("$path", fields, "MRGE"),
    S.setVar("$exportError", "Get ( LastError )"),
    S.setVar("$native", `MBS ( "Path.FileMakerPathToNativePath" ; $path )`),
    S.setVar("$file", `MBS ( "Container.ReadFile" ; $native )`),
    S.setVar("$cleanup", `MBS ( "Files.Delete" ; $native )`),
    S.ifStep(`$exportError ≠ 0 or PatternCount ( GetAsText ( $file ) ; "[MBS]" )`),
    ...fail(`"Could not prepare ${label.toLowerCase()} for " & $account & " (export " & $exportError & If ( PatternCount ( GetAsText ( $file ) ; "[MBS]" ) ; ", " & GetAsText ( $file ) ; "" ) & ")."`),
    S.endIf(),
    S.setVar(`$b64_${x}`, "Base64EncodeRFC ( 4648 ; $file )"),
    S.setVar("$file", `""`),
    S.endIf(),
    S.setVar(`$ms_${x}`, `${NOW} - $tt`),
  ];
}

function build() {
  const L = T.LOCATIONS.server, EQ = T.EQUIPMENT.server, PR = T.PROFILES.server, MF = T.MANUFACTURERS.server;
  const CJ = T["CONTACT JOINS"].server, CO = T.CONTACTS.server, CM = T["CONTACT METHODS"].server, AD = T.ADDRESSES.server;

  const steps = [
    S.comment("Description: Prepares one tech's route for the offline file to download."),
    S.comment("Called over OData by Import Route with { account }. Returns RouteExports keys,"),
    S.comment("never the data itself -- an OData script result holds only ~1 MB."),
    S.comment("#################### #"),
    S.comment("Generated by scripts/generate-build-route-export.js -- edit that, not this."),
    S.comment("#################### #"),
    S.comment(""),
    S.banner("PARAMS"),
    S.setErrorCapture(true),
    S.allowUserAbort(false),
    S.setVar("$t0", NOW),
    S.setVar("$account", `Let ( a = JSONGetElement ( Get ( ScriptParameter ) ; "account" ) ; If ( Left ( a ; 1 ) = "?" ; "" ; a ) )`),
    S.ifStep("IsEmpty ( $account )"),
    ...fail(`"No account was given."`),
    S.endIf(),
    S.comment(""),
    S.banner("THE ACCOUNT'S CUSTOMERS"),
    S.comment("Users and Customers are small tables; ExecuteSQL is fine here."),
    S.setVar(
      "$ids",
      SANITISE(`ExecuteSQL ( "select \\"CustomersAssigned\\" from \\"USERS\\" where \\"Account_Name\\" = ?" ; "" ; "" ; $account )`)
    ),
    S.ifStep("IsEmpty ( $ids )"),
    ...fail(`"No customers are assigned to the account " & $account & ". Ask the office to assign your route before downloading."`),
    S.endIf(),
    S.setVar(
      "$custRows",
      `ExecuteSQL ( "select \\"__kp_Customer\\", \\"Customer_Name\\" from \\"CUSTOMERS\\" where \\"__kp_Customer\\" in (" & $ids & ")" ; Char ( 9 ) ; ¶ )`
    ),
    S.setVar("$customers", `"[]"`),
    S.setVar("$c", "0"),
    S.loop(),
    S.setVar("$c", "$c + 1"),
    S.setVar("$row", "GetValue ( $custRows ; $c )"),
    S.exitLoopIf(`IsEmpty ( $row ) or $row = "?"`),
    S.setVar(
      "$customers",
      `Let ( p = Position ( $row ; Char ( 9 ) ; 1 ; 1 ) ; JSONSetElement ( $customers ; "[" & ( $c - 1 ) & "]" ; JSONSetElement ( "{}" ; [ "__kp_Customer" ; Left ( $row ; p - 1 ) ; JSONNumber ] ; [ "Customer_Name" ; Middle ( $row ; p + 1 ; Length ( $row ) ) ; JSONString ] ) ; JSONObject ) )`
    ),
    S.endLoop(),
    S.comment(""),
    S.banner("CLEAR THIS ACCOUNT'S EARLIER EXPORTS"),
    S.comment("Left behind when a download was interrupted. Delete only on a successful find:"),
    S.comment("after a failed one the found set is whatever it was, possibly everything."),
    S.goToLayout(EXPORTS.layout.id, EXPORTS.layout.name),
    S.enterFindMode(),
    S.setFieldByName(`"${EXPORTS.to}::Account"`, `"==" & $account`),
    S.performFindCurrent(),
    S.ifStep(`Get ( LastError ) = 0 and Get ( FoundCount ) > 0`),
    S.deleteAllRecords(),
    S.endIf(),
    S.comment(""),
    S.banner("LOCATIONS: ACTIVE, ONE REQUEST PER CUSTOMER"),
    S.setVar("$tt", NOW),
    S.setVar("$custList", `Substitute ( $ids ; "," ; ¶ )`),
    S.goToLayout(L.layout.id, L.layout.name),
    ...findEach(L.to, "$custList", [["_kf_Customer", "$val"], ["f_isActive", "1"]], "$locError"),
    S.ifStep(`$locError ≠ 0`),
    ...fail(`If ( $locError = 401 ; "No active locations for the customers assigned to " & $account & "." ; "Could not find the locations for " & $account & " (error " & $locError & ")." )`),
    S.endIf(),
    S.comment("Keys for the finds below, read without leaving the found set."),
    S.setVar("$locKeys", `""`),
    S.setVar("$addrIDs", `""`),
    S.setVar("$r", "0"),
    S.loop(),
    S.setVar("$r", "$r + 1"),
    S.exitLoopIf("$r > Get ( FoundCount )"),
    S.setVar("$locKeys", `List ( $locKeys ; GetNthRecord ( ${L.to}::__kp_Location ; $r ) )`),
    S.setVar(
      "$addrIDs",
      `List ( $addrIDs ; GetNthRecord ( ${L.to}::AddressBill_ID ; $r ) ; GetNthRecord ( ${L.to}::AddressPhysical_ID ; $r ) ; GetNthRecord ( ${L.to}::AddressShip_ID ; $r ) )`
    ),
    S.endLoop(),
    ...exportTable("LOCATIONS", "$locError = 0"),
    S.comment(""),
    S.banner("EQUIPMENT: RELATED TO THOSE LOCATIONS"),
    ...budgetCheck("EQUIPMENT"),
    S.setVar("$tt", NOW),
    S.goToRelatedRecord({ name: EQ.to }, EQ.layout),
    S.setVar("$eqError", "Get ( LastError )"),
    S.comment("101 = no related records: a route with no equipment yet is fine."),
    S.ifStep(`$eqError ≠ 0 and $eqError ≠ 101`),
    ...fail(`"Could not find the equipment for " & $account & " (error " & $eqError & ")."`),
    S.endIf(),
    ...exportTable("EQUIPMENT", `$eqError = 0 and Get ( LayoutTableName ) = "${EQ.to}"`),
    S.comment(""),
    S.banner("GASKET PROFILES: ACTIVE GASKETS"),
    ...budgetCheck("PROFILES"),
    S.setVar("$tt", NOW),
    S.goToLayout(PR.layout.id, PR.layout.name),
    S.enterFindMode(),
    S.setFieldByName(`"${PR.to}::f_isActive"`, "1"),
    S.setFieldByName(`"${PR.to}::ProfileType"`, `"==Gaskets"`),
    S.performFindCurrent(),
    S.setVar("$prError", "Get ( LastError )"),
    ...exportTable("PROFILES", "$prError = 0"),
    S.comment(""),
    S.banner("MANUFACTURERS: ALL"),
    S.setVar("$tt", NOW),
    S.goToLayout(MF.layout.id, MF.layout.name),
    S.showAllRecords(),
    ...exportTable("MANUFACTURERS", "True"),
    S.comment(""),
    S.banner("CONTACT JOINS: THE LOCATIONS' CONTACTS"),
    ...budgetCheck("CONTACT JOINS"),
    S.setVar("$tt", NOW),
    S.goToLayout(CJ.layout.id, CJ.layout.name),
    ...findEach(CJ.to, "$locKeys", [["_kf_Location", `"==" & $val`], ["parentType", `"==Location"`]], "$cjError"),
    S.setVar("$contactIDs", `""`),
    S.ifStep("$cjError = 0"),
    S.setVar("$r", "0"),
    S.loop(),
    S.setVar("$r", "$r + 1"),
    S.exitLoopIf("$r > Get ( FoundCount )"),
    S.setVar("$cid", `GetNthRecord ( ${CJ.to}::_ID_Contact ; $r )`),
    S.ifStep(`not IsEmpty ( $cid ) and not PatternCount ( ¶ & $contactIDs & ¶ ; ¶ & $cid & ¶ )`),
    S.setVar("$contactIDs", "List ( $contactIDs ; $cid )"),
    S.endIf(),
    S.endLoop(),
    S.endIf(),
    ...exportTable("CONTACT JOINS", "$cjError = 0"),
    S.comment(""),
    S.banner("CONTACTS"),
    ...budgetCheck("CONTACTS"),
    S.setVar("$tt", NOW),
    S.setVar("$coError", "401"),
    S.ifStep("not IsEmpty ( $contactIDs )"),
    S.goToLayout(CO.layout.id, CO.layout.name),
    ...findEach(CO.to, "$contactIDs", [["__ID", `"==" & $val`]], "$coError"),
    S.endIf(),
    ...exportTable("CONTACTS", "$coError = 0"),
    S.comment(""),
    S.banner("CONTACT METHODS"),
    ...budgetCheck("CONTACT METHODS"),
    S.setVar("$tt", NOW),
    S.setVar("$cmError", "401"),
    S.ifStep("not IsEmpty ( $contactIDs )"),
    S.goToLayout(CM.layout.id, CM.layout.name),
    ...findEach(CM.to, "$contactIDs", [["_ID_Contact", `"==" & $val`]], "$cmError"),
    S.endIf(),
    ...exportTable("CONTACT METHODS", "$cmError = 0"),
    S.comment(""),
    S.banner("ADDRESSES: THE LOCATIONS' BILL, PHYSICAL AND SHIP ADDRESSES"),
    ...budgetCheck("ADDRESSES"),
    S.setVar("$tt", NOW),
    S.setVar("$adError", "401"),
    S.ifStep("not IsEmpty ( $addrIDs )"),
    S.goToLayout(AD.layout.id, AD.layout.name),
    ...findEach(AD.to, "$addrIDs", [["_ID", `"==" & $val`]], "$adError"),
    S.endIf(),
    ...exportTable("ADDRESSES", "$adError = 0"),
    S.comment(""),
    S.banner("STORE EACH TABLE FOR THE DEVICE TO DOWNLOAD"),
    S.comment("One RouteExports record per table, base64 in a utf-8 text file."),
    S.goToLayout(EXPORTS.layout.id, EXPORTS.layout.name),
    S.setVar("$tables", `"{}"`),
    S.setVar("$builtAt", "Get ( CurrentTimestamp )"),
    ...MAP.tables.flatMap((t) => {
      const x = v(t.label);
      return [
        S.ifStep(`not IsEmpty ( $b64_${x} )`),
        S.newRecord(),
        S.setFieldByName(`"${EXPORTS.to}::Account"`, "$account"),
        S.setFieldByName(`"${EXPORTS.to}::BuiltAt"`, "$builtAt"),
        S.setFieldByName(`"${EXPORTS.to}::File"`, `TextEncode ( $b64_${x} ; "utf-8" ; 1 )`),
        S.commit(),
        S.ifStep("Get ( LastError ) ≠ 0"),
        ...fail(`"Could not store ${t.label.toLowerCase()} for download (error " & Get ( LastError ) & ")."`),
        S.endIf(),
        S.setVar(`$key_${x}`, `${EXPORTS.to}::__kp_RouteExport`),
        S.setVar(`$b64_${x}`, `""`),
        S.endIf(),
        S.setVar(
          "$tables",
          `JSONSetElement ( $tables ; "${x}" ; JSONSetElement ( "{}" ; [ "key" ; $key_${x} ; JSONString ] ; [ "rows" ; $rows_${x} ; JSONNumber ] ; [ "ms" ; $ms_${x} ; JSONNumber ] ) ; JSONObject )`
        ),
      ];
    }),
    S.comment(""),
    S.exitScript(
      `JSONSetElement ( "{}" ;
  [ "account" ; $account ; JSONString ] ;
  [ "customers" ; $customers ; JSONArray ] ;
  [ "tables" ; $tables ; JSONObject ] ;
  [ "totalMs" ; ${ELAPSED} ; JSONNumber ]
)`
    ),
  ];
  return S.wrap(steps, { scriptName: SCRIPT }).replace('runFullAccess="False"', 'runFullAccess="True"');
}

const xml = build();
const outPath = path.join(__dirname, "..", "fmscripts", "BuildRouteExport.xml");
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
        console.log(
          "\x1b[32mCopied as a whole FileMaker script -- paste into the scripts list of GSR_Gaskets Rock_Sandbox.\x1b[0m"
        );
      }
    );
  });
}
