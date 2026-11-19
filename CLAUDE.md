# GR_Offline — Gaskets Rock offline field app

An offline FileMaker file (`GasketsRockOffline.fmp12`) for iPad techs: view assigned
customer locations, create and edit equipment records and locations while offline,
then sync back to the hosted file over OData. The UI is a Parcel-built web viewer
widget; the offline store is the FileMaker tables themselves.

## The one rule

**`fmscripts/*.xml` is build output. Never edit it.** Every FileMaker script is
emitted by a generator in `scripts/generate-*.js`. Change the generator, re-run it,
then paste the regenerated XML into FileMaker. Editing the XML directly means the
next regeneration silently discards the change.

| Script in FileMaker | Generator | npm script |
|---|---|---|
| `Startup`, `GetLocationList` | `generate-startup.js` | `generate-startup` |
| `GetLocationDetail` | `generate-get-location-detail.js` | `generate-get-location-detail` |
| `SaveEquipmentList` | `generate-save-equipment-list.js` | `generate-save-equipment-list` |
| `SaveLocation` | `generate-save-location.js` | `generate-save-location` |
| `UploadChanges` | `generate-upload-changes.js` | `generate-upload-changes` |
| `Initial Download` | `generate-initial-download.js` | `generate-initial-download` |
| `Prepare for Distribution` | `generate-prepare-distribution.js` | `generate-prepare-distribution` |
| `Import Route` (offline file) | `generate-import-route.js` | `generate-import-route` |
| `Build Route Export` (**GSR data file**) | `generate-build-route-export.js` | `generate-build-route-export` |
| `First Setup` (offline file) | `generate-first-setup.js` | `generate-first-setup` |
| `Download Offline App` (**GSR data file**) | `generate-download-offline-app.js` | `generate-download-offline-app` |
| `Backfill __ID`, `... - Run on Server` (**GSR data file**) | `generate-backfill-ids.js` | `generate-backfill-ids` |
| `Dedupe __ID`, `... - Run on Server` (**GSR data file**) | `generate-dedupe-ids.js` | `generate-dedupe-ids` |
| `Download Offline App` (**UI file**, button target) | `generate-ui-download-script.js` | `generate-ui-download-script` |
| field definitions | `generate-sync-fields.js <TableName>` | `generate-sync-fields` |

## Which file each script goes in

Three hosted files, easy to confuse. **`GSR_Gaskets Rock(_Sandbox)`** holds
every table the sync uses, and OData addresses it. **`GasketsRock(_Sandbox)`**
is the UI file -- the layouts and buttons users see; `GSR_` opens it from its
On Open script, and accounts exist separately in each. Probes have been pasted
into the wrong file twice; check the window title before pasting.

| File | Scripts |
|---|---|
| Offline (`GasketsRockOffline`, `_Sandbox`) | `Startup`, `GetLocationList`, `GetLocationDetail`, `SaveEquipmentList`, `SaveLocation`, `UploadChanges`, `Initial Download`, `Prepare for Distribution`, `Import Route`, `First Setup`; house `UploadToHTML`. |
| Data (`GSR_Gaskets Rock`, `_Sandbox`) | `Build Route Export` (runs on the server, called over OData), `Download Offline App` (exports `OfflineApp::File`, opens the copy). Tables `OfflineApp`, `RouteExports`. |
| UI (`GasketsRock`, `_Sandbox`) | `Download Offline App` (a hand-off: Perform Script from file "Data"; refuses outside the sandbox) and the **Download offline app button** (added by hand, hide condition `not inSandbox`) that runs it. |

`zProbe*` scripts are throwaway tests; each generator's header says which file
it belongs in.

`scripts/routeTables.json` is the shared map of the eight route tables -- server
occurrence, layout and field ids; offline occurrence, layout and field ids --
used by both `Build Route Export` and `Import Route`. Regenerate both if it
changes.

`scripts/fmSteps.js` holds the step builders. `scripts/fieldIds.json` maps real
FileMaker field IDs harvested from the DDR — `findBy()` throws rather than emitting
a broken `Perform Find` if an ID is missing, so add the ID there rather than
working around it.

## Getting a script into FileMaker

Use fmClipTools (`~/Code/FmClipTools`, aliases in `~/Library/Scripts`):
open the `.xml`, Select All, Copy, run **fmClip - Clipboard XML to FM Objects**
from the macOS Script menu, then paste into the scripts list in Script Workspace.
The files start with `<Script>`, so they paste as whole named scripts.

**Paste callees before callers.** A Perform Script step binds to the script of
that name *when it is pasted*; pasting a caller first leaves it pointing at
nothing, or at an old copy you then delete -- and the call fails silently.
Offline order: `Import Route`, `Startup`, then `First Setup`. After replacing
`Startup`, re-point File Options -> Script Triggers -> OnFirstWindowOpen.

A script already in the file is not replaced — rename the old one first, verify the
new one, then delete it. `scripts/split-snippet.js` chunks a script into
step-only snippets, only needed when something can't take the whole file at once.

## Build

- `npm start` — Parcel dev server
- `npm run build` — Parcel build, then `inline-build.js`
- `npm run deploy-to-fm` — build, then `UploadToHTML` writes `dist/widget.html` into the
  **sandbox** master's `HTML` table (`GasketsRockOffline_Sandbox`; `deploy-to-fm-live`
  for the live one) as `GasketsRockField` (the record `Startup` loads). Never run
  `npm start` without clearing `dist/` after — the dev server writes a hot-reload build
  there, and `upload.js` refuses to ship it.

**FileMaker Go will not render a base64 `data:` URL** (any length; tested
2026-10-15 on Go 26.0.3), and it does **not** percent-decode a plain one --
`#` sent as `%23` reaches the page literally and breaks every selector, entity
and hex colour. So on iPadOS `Startup` writes the widget to
`Get ( TemporaryPath )` through `Sync_Settings::zg_RouteFile` and loads it as a
`file://` URL; elsewhere it stays base64. On Go,
`GetLayoutObjectAttribute ( "web" ; "source" )` reports `about:blank` for data
URLs even when they render -- judge by eye.

`inline-build.js` folds the stylesheet into the HTML and **exits non-zero if any
external reference survives**. This matters: the widget is loaded from a
`data:text/html;base64,` URL, where `<link rel="stylesheet">` fails silently.
Base64, not percent-escaping — hand-escaping `%` and `#` corrupts minified JS
(`k[e[n]%k.length]` becomes `k[e[n]%25k.length]`).

## Sync model

**Identity.** The widget mints `__ID` before a row ever reaches a server —
21 characters, uppercase base 36, matching the house `uID_CreateWithNoSpaces`
format (`src/utils.js`, `makeUuid()`). Every match, upload and download keys off
`__ID`, never off a serial. This is what makes uploads idempotent.

**Local keys are negative.** The server's `Locations` serial only counts up, so a
location created in the field takes the next negative `__kp_Location`, assigned in
`SaveLocation` (FileMaker serials cannot count down — the increment must be
positive, so this is done in script, not schema). Negative means "not uploaded
yet". `UploadChanges` swaps in the real key after the POST and repoints the
location's equipment. Equipment created in the field gets the same treatment in
`SaveEquipmentList`: the offline serial fires on New Record, then the script
overwrites `__kp_CustomerEquipment` with the next negative.

**Creates are explicit.** Both save scripts create a record only when the widget
says it is new (`isNew`). An unmatched row without it is an error (`SaveLocation`)
or reported in `missing` (`SaveEquipmentList`) — never silently recreated.

**Local-first.** `SaveEquipmentList` and `SaveLocation` commit locally and set
`f_pendingSync`; they never touch the network. `UploadChanges` is the only
outbound script.

**Conflicts.** `Initial Download` records the server's `zzModifiedTimestamp` in
`z_serverModTimestamp`. `UploadChanges` re-reads it before a PATCH and refuses the
row if it moved, reporting it rather than overwriting the office's edit.

## OData

Base: `https://gr.cranstonhost.com/fmi/odata/v4/{database}/`, database chosen by
`inSandbox` (`PatternCount ( Get ( FileName ) ; "Sandbox" )`).

**OData addresses table occurrences, not base tables.** The entity set is a
TO name in `GSR_Gaskets Rock(_Sandbox)`: `CUSTOMER_EQUIPMENT` (base
`CustomersEquipment`, which has no TO of its own name -- `CustomersEquipment`
404s "Table not defined in database", iPad upload 2026-10-15), `Locations`,
`RouteExports`. `generate-initial-download.js` still uses base-table names and
predates this; Import Route replaced it.

`$select` must never include local-only sync fields (`f_pendingSync`,
`z_syncAction`, `z_localModTimestamp`, `z_serverModTimestamp`, `z_lastDownload`,
`f_isActive`) — the server doesn't have them and the request fails wholesale.

**Server-side serials are never sent.** `__kp_CustomerEquipment` and
`_kf_Equipment` both auto-enter on the server. `_kf_Equipment` looks like a foreign
key but is not one: it is a second serial on `CustomersEquipment` (next 823978,
ten behind `__kp_CustomerEquipment`), a leftover primary key that nothing reads and
no relationship uses. `Equipment::__kp_Equipment` is a different range entirely
(next 10000). Do not add it back to the upload body.

## Credentials

`_ODataAuth ( )` reads `Credential` (`Name` = `odata`, `Value` =
`Base64EncodeRFC ( 4648 ; "account:password" )`). It lives in **record data**
because a DDR export captures calculations, auto-enter constants, value lists and
script text but *not* record contents — verified empirically. The scoped
`offline_field_app` account is what limits the damage if the file is copied; see
`fmscripts/ODATA_ACCOUNT.md`. Both network scripts bail out with a readable
message when the credential is missing.

**DDR exports are gitignored** (`*_fmp12.xml`, `Summary.xml`) because they carry
every API credential in the file in plaintext. Keep it that way.

## Reading a DDR

They live in `../../DDRs/<YYYYMMDD>/` and are **UTF-16** — `iconv -f UTF-16 -t
UTF-8` before grepping, and parse with an XML parser rather than regex (script
bodies nest, so a naive `<Script name=` grep counts `Perform Script` targets as
definitions). `Summary.xml` carries the export timestamp; check it before trusting
a DDR is current.

A DDR is the authoritative answer to "what is actually in the file right now" —
schema, script step counts, unresolved references. It holds no record data, so
questions about *values* need `execute_filemaker_sql` over the ProofKit MCP.

## Step IDs

Confirmed against this file: 1 Perform Script, 6 Go to Layout, 7 New Record,
9 Delete Record, 28 Perform Find, 61 Insert Text, 62 Pause, 68 If, 69 Else,
70 End If, 71 Loop, 72 Exit Loop If, 73 End Loop, 75 Commit, 76 Set Field,
85 Allow User Abort, 86 Set Error Capture, 87 Show Custom Dialog, 89 Comment,
103 Exit Script, 121 Close Window, 122 New Window, 141 Set Variable,
146 Set Web Viewer, 147 Set Field By Name, 160 Insert from URL,
175 Perform JavaScript in Web Viewer, 182 Truncate Table.

## Gotchas

- A script the widget calls must not change the main window's layout --
  leaving Home unloads the web viewer, so the callback is lost and the user is
  stranded on a sync layout. Open `S.workWindow(layout)` (a card) for record
  work and answer with `...S.callBack()`, which closes the card first.
- `npm run build` can serve a stale bundle from `.parcel-cache`; check
  `dist/widget.html` for the change, or `npm run clear-cache` first.
- FileMaker injects `window.FileMaker` *after* page scripts run. `fmBridge.js`
  polls via `whenFileMakerReady()` — don't test availability once at module load.
- `asJSON` emits a literal `"?"` for empty date fields. `normalizeFmJson()` strips
  it; `JSONGetElement ( ... ) ≠ "?"` guards the script side.
- Before cloning the master for distribution, run `Prepare for Distribution`. It
  empties the synced tables and `Sync_Settings` (so `DatabaseUUID` and
  `LastSyncUTC` are blank, which the environment guard needs) and keeps `HTML`,
  `Credential` and `ProofKitApps`.

## Current state

See `STATUS.md` for what is pasted, what needs repasting, and what is outstanding.
