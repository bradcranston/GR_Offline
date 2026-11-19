# JS Dev Kit for FileMaker Developers

*Develop, Render, and Deploy JavaScript for a FileMaker App*

# This Kit
## What it does
This environment allows a FileMaker developer to start coding their widget and see the results right away in a FileMaker file. Once done developing, the can be inlined and pushed to the FileMaker file for use offline.
<br/>
It's a template file, so you can use to start other projects.
## Consists of
- A repository template on Github
- A basic html / JS set up.
- package.json file for install
- A FileMaker file to show the widget rendered
- Scripts to build and upload the inlined code to FileMaker
## TO GET STARTED Using this file
1. `npm install`
2. `npm start`
3. Open the jsDev.fmp12 file.
4. Allow it to work in Dev mode.

At this point you should see the web viewer on the layout load up with the HTML and JavaScript here. Edit the JavaScript or the HTML and you'll see the render in the web viewer update.

## Use this kit
Now you're ready to use this kit to create awesome JS widgets.

# Gaskets Rock Field App

An iPad-optimized FileMaker WebViewer app for viewing customer locations and
managing their gasket/equipment lists in the field.

## App structure
- `src/index.js` — entry point; wires up views and exposes the FileMaker-callable functions.
- `src/fmBridge.js` — Promise-based bridge for calling FileMaker scripts from JS.
- `src/devMock.js` — simulates FileMaker script responses when running in a plain browser (`npm start`) so the UI can be built/tested without FileMaker.
- `src/store.js` — app state + local ("offline") draft persistence via `localStorage`.
- `src/cache.js` — offline cache of everything FileMaker pushes (location list, location
  details, manufacturers, gasket profiles) so the app renders with no FileMaker round-trip.
- `src/views/` — `listView.js` (location list), `detailView.js` (location detail + equipment list), `equipmentModal.js` (add/edit equipment form).

## Startup
`Startup` is set as the file's **OnFirstWindowOpen** trigger (File > File Options >
Script Triggers — that setting cannot be pasted in). It loads the deployed widget from the
`HTML` table record named `GasketsRockField`, goes to the `Home` layout, and points the `web`
web viewer at it. It pushes no data. There is no dev-server branch on purpose.

`npm run deploy-to-fm` builds, then runs the file's `UploadToHTML` script over an `fmp://`
URL -- the same house pattern the main file uses. `UploadToHTML` finds (or creates) the
`HTML` record whose `Name` is `widgetName` in `widget.config.js` and reads the file into
`HTML::HTML`. `scripts/upload.js` always sends `dist/widget.html`, the self-contained build
(Parcel links the stylesheet separately, which silently fails inside a `data:` URL), and
refuses a dev-server build. `UploadToHTML` is a house script pasted into the file, not
generated here.

`Startup` URL-encodes `#` before building the `data:` URL. Without that, the first CSS
hex colour — about 40 characters into the build — is read as a fragment identifier and
everything after it is discarded.

The widget then calls `GetLocationList` itself as soon as it is running. That is a pull
rather than a push on purpose: the previous sketch was `Set Web Viewer` → `Pause [1/2]`
→ `Perform JavaScript`, and half a second is a guess that fails silently on a slow iPad.
A pull cannot race, because the widget only asks once it exists.

`GetLocationList` returns the list plus the state the widget needs to decide what to
render — `needsDownload` when the local tables are empty (so the tech is told to run
`Initial Download` instead of staring at an empty list), and `pendingCount`, which badges
the Upload button so a day's unsent work is visible at a glance.

## FileMaker → JS
FileMaker pushes data into the webviewer by calling these global functions directly
(via "Perform JavaScript in Web Viewer"), passing JSON (string or object) as the parameter:
- `loadLocationList(jsonArray)` — renders the landing page list of locations (shape: [listLocationData.json](listLocationData.json)).
- `loadLocationDetail(jsonObject)` — renders a location's detail + equipment list (shape: [detailLocationData.json](detailLocationData.json)).
- `showAppError(message)` — optional, shows an alert with an error message from FileMaker.

## JS → FileMaker
Tapping a location, or syncing equipment edits, calls FileMaker scripts through
`fmBridge.performScript(scriptName, parameter)`, which returns a Promise. The FileMaker
script must read `callbackName` / `promiseID` / `parameter` from `Get ( ScriptParameter )`
and call back into the webviewer via "Perform JavaScript in Web Viewer" with the
function named in `$callbackName`. See `scripts/generate-script-steps.js` for the exact
step XML to paste into a FileMaker script. Scripts currently expected:
- `GetLocationDetail` — parameter `{ __ID }`, returns the full location detail record.
- `SaveEquipmentList` — parameter `{ __ID, equipment }`, persists the full equipment array for a location. Rows added in the field carry `isNew: true`.

## Where the offline data lives
The offline store is the **FileMaker file itself**. The `Initial Download` script pulls
Locations, CUSTOMER_EQUIPMENT, Contacts, ContactMethod, Address, Manufacturers and
Profiles from the server over OData into local FileMaker tables. Every script the widget
calls is therefore a local query that works with no connectivity -- the JS layer never
needs a network round-trip of its own.

`src/cache.js` is a small **boot cache**, not a data store. The WebViewer can reload (or
re-render on layout enter) before FileMaker has pushed anything in, which would otherwise
leave the tech looking at an empty screen; the last pushed location list, manufacturer and
profile payloads are kept in `localStorage` so the app paints immediately, and FileMaker's
push overwrites it a moment later. The app bar shows how old that copy is until the push
lands. Per-location detail is always read live from the FileMaker tables, so it cannot
drift out of sync.

- **Diagnostics:** `grCache.info()` and `grCache.clear()` are exposed on `window`.
- **Testing in a browser:** set `window.grSimulateOffline = true` and reload -- the dev
  mock then rejects every script call, standing in for a broken FileMaker bridge.

## FileMaker scripts
`fmscripts/` holds generated and designed FileMaker artefacts:

- `npm run generate-initial-download` regenerates `fmscripts/InitialDownload.xml` and
  (on macOS) puts it on the clipboard as pasteable script steps. Edit
  `scripts/generate-initial-download.js`, not the XML.
- `npm run generate-startup` regenerates `fmscripts/Startup.xml` and
  `GetLocationList.xml` — what happens when a tech opens the file.
- `npm run generate-get-location-detail` regenerates `fmscripts/GetLocationDetail.xml`.
- `npm run generate-save-equipment-list` regenerates `fmscripts/SaveEquipmentList.xml`,
  the script the widget's save calls. It commits edits to the local table and flags them
  for upload; it never touches the network.
- `fmscripts/SCHEMA_CHANGES.md` — fields that must be added before either script runs.
- `npm run generate-sync-fields` regenerates `fmscripts/SyncFields.xml`, the six
  CUSTOMER_EQUIPMENT sync fields as pasteable field definitions.
- `fmscripts/calcs/` — corrected `asJSON` calculations to paste into Manage Database.
- `npm run generate-upload-changes` regenerates `fmscripts/UploadChanges.xml`, the only
  script that sends field edits back to the server.
- `fmscripts/UPLOAD_DESIGN.md` — the reasoning behind the sync model.

## Editing and creating locations
`src/views/locationModal.js` is the location form. The Edit (pencil) button in the detail
header opens it for the current location; "+ Location" in the list header creates one.

Both go to `SaveLocation`, which commits to the local `Locations` table and flags the row
for upload — the same local-first path equipment takes. The network is never touched here.

The editable set is dictated by the schema: `Location_Name` is auto-entered from
`LocationName_Brand` / `_Identifier` / `_Number`, so the form edits those three;
`VisitNextDate` is auto-entered from `VisitLast + VisitNext`, so the tech sets the interval
in weeks; `ShipAddress1` and `Pricing_ID` are lookups and would appear to save and then
revert, so they are excluded.

A location created in the field takes a UUID in `__ID` (minted in the widget, as equipment
does) and a **negative** `__kp_Location` from the offline file's own serial. The server can
never issue a negative key, so it can't collide, and it reads as "not uploaded yet".
`UploadChanges` creates the location first, writes the real key back, and repoints the
location's equipment at it before sending any equipment.

`_kf_Customer` is `notEmpty` on the server, so a new location must be assigned to a
customer. The picker is fed by `Sync_Settings::CustomersJSON`, which `Initial Download`
fills from the `Customers` entity — the offline file has no Customers table of its own.

## Offline equipment edits
Adding/editing/deleting equipment items updates local state immediately and is cached in
`localStorage` per location, so edits survive an app reload even before they're saved.
Each row carries a client-generated UUID in `__ID` from the moment it is created, so it
has a stable identity before it has ever reached FileMaker -- that is what lets a save,
and later an upload, be retried without duplicating the row.

Tapping "Sync Changes" sends the full equipment array to `SaveEquipmentList`, which
commits it into the local `CUSTOMER_EQUIPMENT` table and flags the rows for upload. That
save is local-only and always works offline.

Adding equipment follows the rules for creating a location. A row added in the form carries
`isNew: true`, and only such a row is created; the flag is dropped once the save lands. A
created row takes a **negative** `__kp_CustomerEquipment`, overwriting the offline file's
serial, whose range came with the production clone and would otherwise sit in the server's
upcoming keys. A row that isn't new and isn't on the device (typically deleted in the office
and purged by `Initial Download`) comes back in `missing`, is dropped from the list, and the
tech is told -- it is not recreated.

The form checks Height and Width against the server's strict validation (whole eighths,
at most 96, Alto-Shaam heights and Alto-profile widths exempt) so a bad measurement is
fixed on the spot rather than failing later at upload.

"Upload" in the locations header is the separate, explicit network step: it calls
`UploadChanges`, which POSTs / PATCHes / DELETEs each flagged row over OData and clears
the flag only on confirmed success. Rows the office changed since this device downloaded
them are reported back as conflicts and left untouched, so neither version is lost.
