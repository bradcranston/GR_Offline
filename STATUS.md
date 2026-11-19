# GR_Offline — where things stand

Last updated 2026-10-08, against the offline DDR exported 4:52 PM that day
(`DDRs/20261008/`).

## In the file and verified

Every generated script matches its generator step for step, calculations
included, with zero unresolved references: `Startup` (51), `GetLocationList`
(43), `GetLocationDetail` (38), `SaveEquipmentList` (195), `SaveLocation` (115),
`UploadChanges` (406), `Initial Download` (674). No calculation is commented
out. The only differences are FileMaker capitalising `true` to `True`.

The widget loads from the `HTML` table (`Name` = `GasketsRockField`, 38,871
characters, inlined production build with Add Equipment), deployed by
`npm run deploy-to-fm` through the house `UploadToHTML` script. The `Credential`
table exists and `_ODataAuth ( )` reads it.

## Needs a paste

| Script | Why it matters |
|---|---|
| `Prepare for Distribution` (new, 69 steps) | Empties route data and `Sync_Settings` before the master is cloned; keeps `HTML`, `Credential`, `ProofKitApps`. Check after pasting that the confirm dialog shows Cancel and Clear Data, with Cancel as the default -- the multi-button dialog XML is new and unconfirmed against this file. |

## Still to do

- [ ] Create the `offline_field_app` account and `OfflineFieldApp` privilege set,
      sandbox first, then production. Spec in `fmscripts/ODATA_ACCOUNT.md`.
- [ ] Load the `Credential` row: `Name` = `odata`,
      `Value` = `Base64EncodeRFC ( 4648 ; "account:password" )`.
- [ ] **Rotate the `server` account password.** The old one was inlined nine times
      in the original `Initial Download` and has been in plaintext in DDR exports.
- [ ] Backfill `__ID` on the hosted `CustomersEquipment` — and confirm existing
      rows carry *values*, not just the field.
- [ ] Clear the offline file's `CUSTOMER_EQUIPMENT` before the first real download.
      UUIDs backfilled locally won't match the server's, and the download matches
      on `__ID`.
- [ ] Before cloning the master for distribution: run `Prepare for Distribution`
      and get "Ready to distribute".

## Settled

**`_kf_Equipment` is not a foreign key.** It is a second auto-enter serial on
`CustomersEquipment` — hosted next value 823978, ten behind
`__kp_CustomerEquipment` at 823988, both `OnCreation`. `Equipment::__kp_Equipment`
is a different range (next 10000) and no relationship in either file references
it. It does carry `NotEmpty` + strict validation, but the serial fills it on
create, so that never bites. It is a leftover primary key that nothing reads, so
the upload body omits it and the server fills it on create.

This unblocks "Add Equipment" in the field, and means no equipment-type picker is
needed.

## Add Equipment in the field — in the file, not yet tested

Script and widget are both in the file. Checked in a browser against the dev
mock only (bad height blocked, new row sent with `isNew`, flag gone on the next
sync).

`GasketsRockOffline` has no "Sandbox" in its name, so `inSandbox` is false and
an Upload from it posts to **production**. Run these from a copy whose name
contains "Sandbox":
   - Add equipment at an existing location, Sync. Local row: negative
     `__kp_CustomerEquipment`, `z_syncAction` = `create`, badge up by one.
   - Upload. Server row carries the same `__ID`; local key replaced by the
     server's; pending cleared.
   - Save the same list again: no duplicate.
   - New location + new equipment, one Upload: location first, equipment lands
     on the real `__kp_Location`.
   - Delete a row in the office, Initial Download, Sync a stale draft: reported
     missing, not recreated.
   - POST a Height of 10.1 directly and confirm OData enforces the "only during
     data entry" validation. The form now blocks it either way.
   - Initial Download after the upload: row matched on `__ID`, no duplicate.

Loose ends found along the way:
- An Aug 31 offline DDR sits in the repo root. Gitignored, but a stale copy of
  the credentials in the working tree -- delete it.

## Server-side build — option B, proven end to end, ready to build

The server exports each tech's route as Merge (.mer) files and the device imports
them, instead of the device running Initial Download over OData. `Save a Copy
As` does not run on this server, which ruled out shipping a finished file.
Design in `fmscripts/SERVER_BUILD_DESIGN.md`.

- [x] Server probe (2026-10-09, FMS 22.0.6 on Linux, MBS 16.4): Merge export
      under PSoS works in temp and Documents; .fmp12 does not (error 800).
      `Container.ReadFile ( path )` and `Files.Delete` work.
- [ ] Delete the `zProbe` scripts: `zProbe_RouteFile` from `GSR_Gaskets Rock_Sandbox`,
      the other three from `GasketsRockOffline_Sandbox`. Keep `Sync_Settings::zg_RouteFile`.
- [x] Device half on the Mac (2026-10-09): OData script call -> base64 Merge
      -> container -> temp file -> Import by name, 99 rows, 397 ms.
- [x] Same probe in FileMaker Go on an iPad (26.0.3): identical, 335 ms.
- [x] Real-data probe run 1 failed: 502 after 603 s -- ExecuteSQL subqueries on
      669k equipment rows. Run 2 uses finds + Go to Related Record only, with a
      300 s budget. Repaste `zProbe_RouteEquipment` in the live sandbox file.
- [x] Real-data probe run 2: 200 in 10.4 s, but the result was truncated at
      ~1 MB (code 736). The file must come down as a container (`RouteExports`),
      not inside the script result.
- [x] Real-data probe (`npm run generate-probe-route-equipment`, then `... device`):
      one real route's equipment, all 52 downloaded fields, size + timing +
      notes with line breaks / quotes checked byte for byte.
- [ ] **Urgent:** the odata credential is the full-access `server` account, and
      the Users table holds passwords -- any offline copy can read every
      user's password over OData. Create `offline_field_app` with no access to
      the Users password field before any copy reaches a tech.
- [x] Techs sign in with their own accounts (2026-10-09). Spec in
      `fmscripts/ODATA_ACCOUNT.md`.
- [x] In the offline master: `FieldTech` privilege set (with **view** on
      `Credential`), one account per tech named exactly as their
      `Users::Account_Name`, auto-login off, strong `Admin` password.

## Install from the live file — proposed, probing

A "Download offline app" button in the live file saves the master into
FileMaker Go and opens it with the signed-in account; `First Setup` creates
only that account (password typed once), signs in as it, imports the route and
switches off `[Guest]`. Design in `fmscripts/SERVER_BUILD_DESIGN.md`.

- [x] Add `Sync_Settings::zg_SetupPassword` (global text) to the offline
      sandbox copy; paste `zProbe - First Setup` (`npm run generate-probe-install`);
      run it with no parameter on the Mac, then the iPad.
- [x] In `GSR_Gaskets Rock_Sandbox`: table `OfflineApp` (`Name`, `File`
      container), one record holding a closed copy of the offline sandbox file
      that contains `zProbe - First Setup`; paste `zProbe - Download Offline App`
      (`... generate-probe-install live`); run it in FileMaker Go.

Checked against DDR 2026-10-09 16:19:
- [x] Offline sandbox copy: all 8 generated scripts and 3 probe scripts match;
      `zg_RouteFile`, `zg_SetupPassword` present; auto-login `[Guest]`, Guest active.
- [x] `[Guest]` on its own set "Guest Access" (DDR 2026-10-15): view `HTML`
      only, no `Credential`, `fmurlscript` on, auto-login `[Guest]`. Optional:
      menus Minimum, exporting/printing off; `fmurlscript` off again on
      `[Read-Only Access]`.
- [x] Re-duplicate the copy into `OfflineApp::File` (0 records as of DDR 2026-10-14).
- [x] `GSR_Gaskets Rock_Sandbox`: `OfflineApp` (Name, File) with 1 record;
      `zProbe_RouteEquipment` matches.
- [x] Paste `zProbe - Download Offline App` into `GSR_Gaskets Rock_Sandbox`;
      delete `zProbe_RouteFile`, `zProbe - Server Export`, `zProbe - Run Server Export` there.

Checked against DDR 2026-10-14 (live files only): still the old 104-step
`zProbe_RouteEquipment` (repaste the 118-step one before running the device
probe), `zProbe - Download Offline App` not pasted, old probes not deleted,
**`OfflineApp` has 0 records** -- re-insert the offline copy. The Download
button belongs in the UI file `GasketsRock`, calling the data-file script.

- [ ] Replace the `_ODataAuth` custom function body with
      `fmscripts/calcs/_ODataAuth.txt` in the offline sandbox copy, then the
      production offline file. An account that cannot view `Credential` got
      `"?"`, which passed the `IsEmpty` guards and went out as
      `Authorization: Basic ?` (401). Found running the route probe as Guest,
      2026-10-15. Tech accounts (`FieldTech`) need view on `Credential`.

- [x] First Setup probe run 1 (Mac, probably the hosted copy): Add Account 0;
      Enable Account on `[Guest]` 212; Re-Login 9. Design changed: Guest stays
      on and `Startup` re-logs in with a dialog once `Initialized` is set.
      "Guest Access" needs view on `Sync_Settings::Initialized`.
- [ ] Check `zprobe_tech` was deleted (Manage Security) in the offline sandbox copy.

- [x] Install probe run 3 (iPad, 2026-10-15): live file -> Documents -> fmp://~/
      URL -> local copy as Guest -> First Setup -> Add Account 0 -> Re-Login 0.
      The install hand-off is proven. Delete `GasketsRockOffline_SandboxInstall`
      from the iPad.
- [x] `RouteExports` created (DDR 2026-10-15 11:10, layout 353). Its stray
      `__kp_CustomerEquipment` field can go.
- [x] Real-data probe run 3: server side 4.7 s for 13,750 rows (11.3 MB file);
      OData DELETE of the RouteExports record 204. Download failed: Insert from
      URL field id 0 unresolved (102). Fixed with id 36.
- [x] Real-data probe run 4: server saves the file to `RouteExports` and returns
      the key; device downloads `RouteExports(<key>)/File/$value`, imports,
      checks notes, deletes the server record. Replace both zProbe route
      scripts, run signed in as Admin.

- [x] Route probe run 5: container download over OData works (200, 2.6 s,
      11.3 MB) -- but Insert from URL into a variable yields the Merge file as
      TEXT (UTF-16 decoded, 5,628,642 chars). Run 6 rebuilds the file with
      `TextEncode ( text ; "utf-16" ; 1 )`.

- [x] Route probe run 6: TextEncode of the downloaded text gave no usable file
      (size "?"); import 409 "import order invalid" = no readable header row.
      Run 7: server stores base64 text (utf-8 file) in RouteExports; device
      Base64Decodes it -- the transfer the Profiles probe proved on Go.

- [x] Route probe run 7 (iPad, hosted copy): full route intact -- 13,750 rows,
      base64 transfer exact, every sample note exact, cleanup exact, server
      record deleted. Import took 23.5 min because the copy was hosted.
- [x] Run 8 (iPad, local copy): 13,750 rows imported in 11.9 s; whole first
      load ~26 s. **Every piece of the server build is proven.**

## Server-side build — building

- [x] `Build Route Export` generated (453 steps, GSR data file, runs with full
      access): customers from Users, locations by customer, equipment by Go to
      Related Record, profiles, manufacturers, contact joins / contacts /
      contact methods / addresses by exact finds; each table to its own
      `RouteExports` record as base64. 5-minute budget.
- [x] `Import Route` generated (423 steps, offline file): downloads every
      table before touching local data, then per table Delete All + Import by
      name; stamps z_serverModTimestamp (Locations, equipment) and
      z_lastDownload (equipment); Sync_Settings as Initial Download; deletes
      the server records.
- [x] Tested 2026-10-15 (FileMaker Pro, local copy, "Head Office"): all eight
      tables expected = imported, no errors -- 777 locations, 13,750
      equipment, 2,182 contact joins, 1,474 contacts, 1,733 contact methods,
      527 addresses, 197 manufacturers, 83 profiles. Server 16.5 s, download
      8.0 s, local replace 33.4 s, total 60.5 s.
- [x] `First Setup` generated (80 steps, full access): refuses reserved names
      and set-up copies, password typed once, Add Account [FieldTech], marks
      `Initialized`, Re-Login, Import Route with Try Again, then Startup.
- [x] `Startup` (77 steps, now full access): Guest + set up -> FileMaker sign-in
      dialog (3 tries); Guest + not set up -> exits quietly (First Setup follows
      on an install). **Re-point the OnFirstWindowOpen trigger after pasting.**
- [x] `Download Offline App` generated (39 steps, GSR data file): environment's
      OfflineApp record by Name, confirm, export, open with First Setup.
- [x] Install test on the iPad (see the order in the next message).
- [ ] Button in GasketsRock: Perform Script [ "Download Offline App" from file
      GSR_Gaskets Rock ].

- [x] Install test 2026-10-15: "seems to work but the web viewer does not load
      on the iPad local copy". Likely cause: `FieldTech` lacks `fmurlscript`,
      which `FileMaker.PerformScript` needs (spec corrected in ODATA_ACCOUNT.md).
      Add it, re-duplicate the master into OfflineApp, reinstall.
      Screen shows only "?" -- the widget was never loaded. Most likely
      First Setup was pasted before Import Route and the new Startup existed,
      so its Perform Script steps bound to nothing / the deleted old Startup.
      Re-paste First Setup, check both Perform Script targets and the
      OnFirstWindowOpen trigger, add fmurlscript to FieldTech, reinstall.
      DDR 2026-10-15 12:55 (offline master): First Setup's links are fine
      (Import Route, Startup); FieldTech views HTML and Credential. Actual
      problems: **Startup is not "run with full access"** (Guest then cannot
      read Sync_Settings, decides "not set up" and exits -- empty "?" on
      reopen), and **FieldTech lacks fmurlscript**. A stray `RouteExports`
      table exists in the offline master -- it belongs only in the live file.
- [x] Install on the iPad works end to end (2026-10-15, SFlynn, local copy):
      FieldTech account, Initialized 1, 465 locations, 10,371 equipment,
      widget present (38,871 chars). **But the web viewer stays at about:blank
      (source length 11) even after Startup's Set Web Viewer** -- FileMaker Go
      does not take the ~52,000-char `data:text/html;base64,` URL. The widget
      had only ever been shown in FileMaker Pro. Testing which sources Go
      loads with `zTest - Web Viewer` (generate-test-web-viewer).
- [x] `zTest - Web Viewer` run 1 (FileMaker Go 26.0.3): plain `data:text/html,`
      shows; **any `;base64` data URL does not** (166 chars or 51,862); https
      shows. Startup's base64 data URL cannot work on Go.
- [x] Run 2: the real widget via GetAsURLEncoded data URL (E), plain data URL
      with only # escaped (F), or a file written to the temp folder (G).
- [x] `zTest - Web Viewer` run 2: plain data URL with only `#` as `%23` loads
      the widget, styled (F); GetAsURLEncoded shows the source as text (E);
      temp-file URL inconclusive (G). `Startup` now builds the plain form on
      iPadOS (`Get ( SystemPlatform ) = 3`) and keeps base64 elsewhere (83 steps).
- [x] Reinstall with that: the widget runs but shows `&%23039;` and
      "'%23locationListEl' is not a valid selector" -- Go does not decode %23.
      The styled error screen in run 2 was G's, so G (temp file) works.
- [x] `Startup` (95 steps) writes the widget to `Get ( TemporaryPath )` and
      loads `file://...widget.html` on iPadOS. Pasted, reinstalled, **widget
      loads on the iPad local copy** (DDR 20261015, 2026-10-15).
      Replace Startup's STEPS in place (fmscripts/Startup_steps.xml) so the
      trigger, First Setup's call and full access stay intact. To check: the
      drop-down arrow icon (nested SVG data URI with %3c/%3e) on the iPad.

## Sync button left the user on a data layout (2026-10-15)

- [x] `SaveEquipmentList` (209), `SaveLocation` (132), `UploadChanges` (417)
      now do their record work in a card window (`S.workWindow`) and close it
      before calling back (`S.callBack`). Before, they switched the main
      window to EquipmentSync/LocationsSync, which unloads the web viewer:
      the callback had no "web" object, the widget timed out, and the user
      was stranded. The local save itself did happen. All three pasted
      (DDR 20261015 14:11). Not yet tested on the iPad.
- [x] Widget: the detail button reads **Save Changes / Saved** (was Sync
      Changes / Synced) -- it only saves on the iPad; **Upload** on the list
      sends to the server. Deployed to GasketsRockOffline_Sandbox (deploy-to-fm
      now targets the sandbox; deploy-to-fm-live for production). Also landed
      in the live GasketsRockOffline once by mistake, if it was open.
- [ ] iPad test: Save Changes stays on the location; Upload sends; the edit
      shows in GSR_Gaskets Rock_Sandbox.

## Blank __ID on old server rows (2026-10-15)

- [ ] iPad save at SaltGrass / Research Austin: 45 of 127 rows "missing" --
      rows that predate the __ID auto-enter are blank on the server, so on the
      device too. Paste `Backfill __ID` + `Backfill __ID - Run on Server`
      (generate-backfill-ids) into GSR_Gaskets Rock_Sandbox, run the caller,
      then reinstall. Production later, same scripts.
- [x] SaveEquipmentList marked every row it received pending. Fixed: the
      widget flags edited rows `isChanged` (new rows `isNew`); the script
      writes and queues only those, and still uses the full list to detect
      removals. SaveEquipmentList 214 steps pasted, widget deployed (DDR 16:39).
- [x] iPad retest: one edit queued exactly 1 row (changed-row fix works).
- [ ] That upload failed ("1 could not be sent") with no reason shown; the
      reason only lives in the device's `z_syncError`. `UploadChanges` (422)
      now returns `failures` [{table, __ID, label, error}] and the widget lists
      them; the widget also stops reading the credential/environment guards'
      `{ error }` as "Nothing to upload". Repaste, deploy-to-fm, reinstall,
      Upload again, read the reason.
- [ ] Reason: `404 -- Table 'CustomersEquipment' not defined in database`.
      OData wants a table occurrence; the equipment entity is now
      `CUSTOMER_EQUIPMENT`. UploadChanges repaste only (no widget change).
- [ ] Next: lookup works; PATCH `400 -- Incompatible types in assignment`.
      Field types match the server; suspect typed text in a number field.
      UploadChanges (426) now sends GetAsNumber for numbers and appends the
      body to any 400 so the field shows. Repaste, Upload again.
- [ ] Cause: `"Date_Gasket_Installed":"?-0-0"` -- the device's date field held
      a non-date and ChangeDate_FM_to_JSON formatted it. UploadChanges (430)
      sends the date only when IsValid with a real year. Still unknown: how a
      non-date got into the field (the widget's date input is free text;
      SaveEquipmentList writes it as-is). Look at that next.
- [x] 600705 uploaded (door = 4 Sided Door, server modified 2026-10-15 17:15).
- [ ] Server has duplicate __IDs: 600705 exists twice under one id; the
      upload edited whichever came back first. `Dedupe __ID` +
      `... - Run on Server` (generate-dedupe-ids) for GSR_Gaskets Rock_Sandbox:
      find "!" on __ID, oldest copy keeps it, the rest get new ids. Then
      reinstall. A91178 (91178) did not update -- upload message unknown.
- [ ] UploadChanges should refuse when the __ID lookup returns more than one
      row instead of patching value[0].

## One-tap save and office form rules (2026-10-16)

- [ ] Widget: the equipment modal's Save (and delete) writes to FileMaker at
      once; the header shows **Retry Save** only when that fails. A second
      edit during a save is folded into one follow-up save.
- [ ] Equipment form follows "Equipment - List • New" (GasketsRock DDR
      2026-10-15): Product Type Refrigerator/Warmer/Gaskets; Warmer uses the
      MFGs - Warmer type list; Gaskets hides Manufacturer/Type/Door; Door is a
      list; Door Sides (Top/LH/RH/Bottom) and No Magnet are checkbox diagrams;
      picking a door sets the default sides (server DoorOption auto-enter);
      sides hidden for 4 Sided; Bottom magnet hidden/cleared for Walk In not
      4-sided and Full/Anthony 3-sided (server NoMagnet auto-enter); 3/2-sided
      side-count warning (office conditional formatting); Inverted Profile is
      a checkbox; substitute linear ft only with Substitute Part; install date
      is a date picker.
- [x] Door choices: Product::sideOptions/sideDefault (37 rows, read
      2026-10-16) embedded in src/productSides.js. Changing type keeps a door
      the type offers, else sets sideDefault (server Door auto-enter). A copy:
      re-read if the office edits Product, or add Product to the route.
- [x] Dedupe __ID ran in GSR_Gaskets Rock_Sandbox. 600705: 128975 kept
      2YECQBFZ54GLSJX5ZUY554J4K (the row the iPad edit updated); 129777 got
      321GWKKBX564L3SQSW1GUMJMC. Reinstall before retesting.
- [ ] SaveEquipmentList (217): Date_Gasket_Installed built from YYYY-MM-DD
      with Date () -- the raw ISO text made the "?-0-0" upload failure.
- [ ] Server: CustomersEquipment::DoorOption auto-enters from Door (replaces
      existing). A PATCH changing Door may reset custom door sides to the
      default. Check after the first such upload.

## Dialog titles and working screens (2026-10-16)

- [ ] Widget: alert()/confirm() replaced by in-app dialogs (src/views/dialog.js)
      with real titles -- Go titled the native ones "widget.html".
- [ ] Work card is now 360x140 (New Window Height/Width) plus Freeze Window:
      SaveEquipmentList 218, SaveLocation 133, UploadChanges 431. Import Route
      425 and First Setup 82 freeze the window. Paste order: Import Route,
      then First Setup (it calls Import Route), the save/upload scripts any
      order. Then deploy-to-fm.
- [ ] By hand in the offline master: restyle EquipmentSync (7) and
      LocationsSync (5) -- the card shows only their top-left 360x140. Put a
      plain panel there ("Saving..." / "Uploading..."), move the fields below
      that area -- keep them on the layout rather than delete them. Hide the status
      toolbar in File Options / layout setup.

- [ ] UI file button (sandbox only): paste `Download Offline App`
      (generate-ui-download-script, 8 steps) into GasketsRock_Sandbox; add a
      button running it with hide condition `not inSandbox`. Remove the hide
      and the script's sandbox guard when the field app goes live.
