# Server-side build — design (option B)

Status: **building.** `Build Route Export` + `Import Route` built and tested
2026-10-15: the full eight-table route for "Head Office" (777 locations, 13,750
equipment, ~20k rows in all) installed in 60.5 s on a local copy, every count
exact. Still to build: `First Setup`, `Startup` Guest handling, `Download
Offline App` and its button. Probes 2026-10-09
(`generate-probe-server-export.js`, `generate-probe-route-file.js`), on the
server, FileMaker Pro and FileMaker Go.

## The goal

A tech installs the app and their route arrives in one step. Today a fresh copy
opens empty and the tech runs `Initial Download` on the iPad, which makes one or
more OData requests per table over whatever connection they have. The server
should gather the route, and the device should import it in one go.

`Initial Download` stays. It is still how a tech refreshes their route later,
and it matches on `__ID`, so imported rows and later downloads agree.

## Why not a finished file (option A)

`Save a Copy As` does not run on this server. A hosted file can still be copied
with `fmsadmin backup` through MBS's shell functions, but that needs an FMS admin
password stored where a server script can read it, plus a shared build file and
a lock so two techs' routes never mix. Option B needs neither.

## How it works

```
 iPad (FileMaker Go, the normal cleared copy)       gr.cranstonhost.com
 ──────────────────────────────────────────         ───────────────────
 Get My Route ── PSoS / OData script call ──────▶   GSR_Gaskets Rock
                                                      Build Route Export [ account ]
                                                        Users → CustomersAssigned
                                                        find Locations, then children
                                                        Export Records → .mer per table
                                                        MBS Container.ReadFile → RouteExports
               ◀── record id ────────────────────
 download each container
 Export Field Contents → temp folder
 Import Records (matching names, Add) per table
 set Sync_Settings, refresh the widget
```

### Server: `Build Route Export` (new, in `GSR_Gaskets Rock`)

Parameter `{ account }`. Returns `{ exportID }` or `{ error }`.

1. **Resolve the route** exactly as `Initial Download` does: the `Users` record
   for the account gives `CustomersAssigned`, which gives the active Locations
   (`f_isActive = 1`, `_kf_Customer` in the list).
2. **Find each table's records** from that found set, using the same rules as
   `Initial Download`'s `TABLES` config: equipment and contact joins by
   location (joins where `parentType = Location`), contacts and contact
   methods by those joins, addresses by the three address ids on each
   location. Manufacturers and gasket profiles use their own filters.
3. **Export each found set** to `Get ( TemporaryPath ) & "<table>.mer"` as
   Merge (`DataType="MRGE"`) -- the server will not write .fmp12. The exported fields are the offline file's `*Sync` layout
   fields minus the local-only ones, the same list `Initial Download` sends
   as `$select`.
4. **Store the files**: `MBS ( "Container.ReadFile" )` each one into a
   container on a `RouteExports` record (`Account`, `BuiltAt`, one container
   per table, or one child row per table). Delete the temp files. Replace that
   account's previous export.

Each PSoS session has its own found sets, so techs can build at the same time
with no lock. There is no copying of a file that is open on the server, and no
admin password.

### Device: `Import Route` (new, in the offline file)

1. **Refuse if anything is pending** (`f_pendingSync = 1`), as `Initial
   Download` does. In practice this runs on an empty copy.
2. Call `Build Route Export` (PSoS if the device is signed in to the hosted
   file, or the OData script endpoint with the `odata` credential).
3. Fetch each container, Export Field Contents to the temp folder.
4. **Import Records**, one per table, `MatchFieldNames="True"`, method Add,
   auto-enter off, so `__ID` and the server keys come through as they are.
   The import step format is in the GSR DDR (`Distributor - IMPORT Order(s)
   from a Distributor`).
5. Stamp `z_lastDownload` and set `Sync_Settings` (`DatabaseUUID`,
   `LastSyncUTC`, `CustomersJSON`) the way `Initial Download`'s FINISH block
   does, so `UploadChanges` and the environment guard behave identically.
6. Call the widget's list refresh.

## Server script limits (real-data probe run 1, 2026-10-09)

The first full-route probe waited **603 s** and got **502 Bad Gateway** from
nginx in front of FileMaker Server: the proxy gives an OData script call about
10 minutes. The server script spent that time in ExecuteSQL --
`count(*) ... where _kf_Location in (select ...)` over 669,530 equipment rows,
once per candidate account, plus `LIKE` queries for samples. FileMaker SQL
handles `IN (subquery)` badly on big tables.

Rules for `Build Route Export`:

- **No ExecuteSQL against the big tables.** Find the route with indexed finds
  and Go to Related Record; take sizes from `Get ( FoundCount )`.
- **Budget the time.** Stop well inside the proxy's ~600 s and return an error
  that says so, rather than let the connection drop with the script still
  running on the server.
- A dropped connection does not necessarily stop the script: check the Admin
  Console for a leftover session after any 502.

Real-data probe run 2 (2026-10-15, no SQL subqueries): **HTTP 200 in 10.4 s**
for the largest route under the 30,000-row cap (account `Head Office`) --
finds, Go to Related Record, export and encode are fast. But the script result
came back as **code 736 "Result parameter truncated"** at **1,000,124
characters**: an OData script result holds about 1 MB, and a full route's
base64 Merge file does not fit. (UTF-16 doubles the text; base64 adds a third.)

**So the file cannot travel in the script result.** `Build Route Export` saves
it into a stored container on a `RouteExports` record in `GSR_Gaskets Rock` and
returns only the record's key. The device downloads the container directly with
Insert from URL into `Sync_Settings::zg_RouteFile`:
`.../RouteExports(<key>)/File/$value` -- binary, no 1 MB result limit, no
base64. `RouteExports`: `__kp_RouteExport` (serial, unique, not empty, so
OData keys on it as it does `CustomersEquipment`), `Account`, `BuiltAt`,
`File` (stored container). The record is deleted after the download or
replaced on the next build. `offline_field_app` needs view on it.

Real-data probe run 3 (2026-10-15, file stored in `RouteExports`): largest
route under the cap is `Head Office` -- 111 customers, 777 locations, **13,750
equipment rows**. Server **4.7 s** total (find + Go to Related Record 0.75 s,
export 1.9 s, samples 1.3 s, save to `RouteExports` 0.26 s); the Merge file is
**11.3 MB** (UTF-16 -- UTF-8 would roughly halve it). Script result 761 chars,
call 5.3 s. **OData `DELETE RouteExports(<key>)` returned 204**, so key
addressing works. The download itself failed (error 102, field missing): the
Insert from URL target used field id 0 and did not resolve on paste. Fixed
with the real id (36); run 4 repeats it.

Real-data probe run 7 (2026-10-15, FileMaker Go): **the full route arrives
intact.** Server 5.8 s for 13,750 rows; the file is stored in `RouteExports`
as base64 text (15,009,712 chars, encoded in 1 s) inside a utf-8 text file.
Device: download 200, 15,009,712 chars received; `Base64Decode` rebuilt
exactly 11,257,284 bytes; **import error 0, 13,750 rows; every sample note
(line breaks, quotes) byte-exact**; cleanup exact; server record deleted (204).

Why base64: downloading the raw UTF-16 Merge file into a variable gave text
(FileMaker decoded it) and neither Set Field nor `TextEncode` turned it back
into an importable file (runs 5-6, import 409). Base64 is ASCII, so the text
is exact and `Base64Decode` rebuilds the file -- 33% more to download.

**Import time is not yet measured where it matters.** Run 7 took 1,409 s
(23.5 min) to import because the copy was the *hosted* sandbox file: every row
crossed the network to the server. A tech's copy is local.

Real-data probe run 8 (2026-10-15, FileMaker Go, **local copy**): the same
13,750-row route -- server call 11.2 s, download + decode 3.0 s, **import
11.9 s**, every sample note exact, cleanup 0.06 s, server record deleted.
**A first load for the largest route under the cap takes about 26 seconds.**

## Install from the live file (proposed 2026-10-09)

The tech installs the app from the live file instead of being handed a copy,
and the copy carries **only that tech's account**.

**Live files, "Download offline app"**, run in FileMaker Go while signed in.
The button sits in the UI file (`GasketsRock`), where users' layouts live; it
runs `Download Offline App` in the data file (`GSR_Gaskets Rock`), which holds
`OfflineApp`. Both files are open on the device, so the cross-file call runs
locally and `Export Field Contents` writes to the iPad.

1. The tech's identity is `Get ( AccountName )` of the live session --
   already authenticated, cannot be mistyped.
2. Export the cleared master from `OfflineApp::File` (one record, refreshed by
   an admin after each `Prepare for Distribution`) to `Get ( DocumentsPath )`.
   It must be a stored container in a real record: a global set in one hosted
   session is not visible in another. `OfflineApp::Name` is the file name the
   copy is saved under (without `.fmp12`), because `inSandbox` reads the file
   name: `GasketsRockOffline_Sandbox` in the sandbox file, `GasketsRockOffline`
   in production. Refuse a mismatch -- a `Name` containing "Sandbox" in the
   production file, or one without it in the sandbox -- rather than trust the
   upload. (The probe ignores `Name` and always saves as
   `GasketsRockOffline_SandboxInstall.fmp12`.)
3. `Open URL [ "fmp://~/" & <Name> & ".fmp12?script=First Setup&param=<account>" ]`.

**Offline file, `First Setup`** (runs with full access -- account steps
require it):

1. Refuse without an account parameter, so opening the master directly does
   nothing.
2. Ask once for a password (input into `Sync_Settings::zg_SetupPassword`,
   cleared immediately). The password never travels: the live file cannot read
   the session password, and copying it from the Users table would put it in
   a URL.
3. `Add Account` [ account ; password ; `FieldTech` ], `Re-Login` as it.
4. `Import Route` (above).
5. ~~`Enable Account [ Deactivate ; "[Guest]" ]`~~ -- returned **212** in the
   first probe (2026-10-15); see "Every later open" below for the replacement. The master opens as `[Guest]`
   (File Options); with Guest off, every later launch asks for the tech's
   account, which FileMaker Go can keep in the keychain. Guest's privilege set
   needs the `fmurlscript` extended privilege for step 3 of the live side.

**How the copy opens.** DDR 2026-10-09 12:46: no auto-login, `[Guest]`
inactive. DDR 16:19: auto-login `[Guest]`, Guest active -- but on
`[Read-Only Access]`, which lacks `fmurlscript` and can read `Credential`.
OnFirstWindowOpen runs `Startup`. The master therefore needs:

- File Options -> **Log in using: Guest account**.
- `[Guest]` **active** with its own privilege set, `FirstOpen`: records view
  on `HTML` only (so `Startup` can load the widget) -- **no access to
  `Credential`** or any other table; layouts view only; scripts executable
  only; extended privilege `fmurlscript` only (or the URL's script is
  refused). `fmapp` is not needed: the copy on the iPad is local.
  Not the built-in `[Read-Only Access]`: it can read every record, including
  the `odata` login in `Credential`, with no sign-in at all.

First open: the URL opens the copy -> auto-login as Guest -> `Startup` loads
the widget (empty tables, "no locations yet") -> the URL's `First Setup` runs
(expected after OnFirstWindowOpen; the probe confirms) -> Add Account, Re-Login,
Import Route, Guest off -> refresh the widget, since `Startup` ran as Guest.

Every later open (revised 2026-10-15, after Enable Account on `[Guest]`
returned 212): Guest stays on. `First Setup` sets `Sync_Settings::Initialized`
when it finishes. `Startup`, seeing `Get ( AccountName ) = "[Guest]"`:
- set up -> `Re-Login` with FileMaker's own dialog; the tech signs in once and
  FileMaker Go keeps it (the file already allows keychain saving);
- not set up -> "Install from the Download button in the Gaskets Rock app".
"Guest Access" needs view on the one field `Sync_Settings::Initialized` for this.

Install probe run 2 (FileMaker Go, 2026-10-15): from the hosted live sandbox
file, `Export Field Contents` wrote the 3.9 MB copy to Documents, the
`fmp://~/...?script=...&param=...` URL opened the local copy, it signed in as
`[Guest]` automatically and ran `First Setup` -- the whole hand-off works.
`Enable Account` on `[Guest]` returned 212 on the local copy too. Add Account
failed (12) because the parameter was `Admin`, which the master already has:
**`First Setup` must refuse an account name that already exists** (at least
`Admin`) instead of failing on to Re-Login.

Install probe run 3 (FileMaker Go, 2026-10-15): **the install works end to
end.** From the hosted live sandbox file: export 0 (3.9 MB), URL opened the
local copy as `[Guest]`, `First Setup` ran with the parameter, **Add Account 0,
Re-Login 0** -- signed in as the new account (`[Data Entry Only]` in the probe).
Guest toggle 212 as expected. The earlier Re-Login 9 was the hosted copy.

Re-Login as a new account returned **9** in that probe -- most likely because
the copy was hosted, where signing in needs `fmapp`. A tech's copy is local;
the install probe (run on the iPad) confirms.

Opened directly instead of from the Download button, the copy lands as Guest
with no setup. `Startup` should detect `Get ( AccountName ) = "[Guest]"` and say
"Finish setup from the Download button in the Gaskets Rock app".

This replaces "every copy carries every tech's account" (`ODATA_ACCOUNT.md`):
no per-tech copies, no shared master accounts, a new hire just taps Download.

Anyone who edits the `param` in that URL gets another tech's route -- no worse
than today, where the shared OData account can already read every route.

**Security, found while designing this:** the Users table stores account
passwords, and every offline copy carries the `odata` login, which today is the
full-access `server` account. Anyone holding a copy can read every user's
password over OData. `offline_field_app` must have **no access to the password
field** on Users (it needs only `Account_Name` and `CustomersAssigned`), and
plaintext passwords in a table are worth retiring.

Probe: `scripts/generate-probe-install.js` -- `zProbe - First Setup` (offline)
and `zProbe - Download Offline App` (live).

## To prove first

Probe run 1 (2026-10-09): the server is **FileMaker Server 22.0.6 on Linux**,
MBS 16.4. PSoS ran, the layout resolved, 83 Profiles found. Export Records to
`Get ( TemporaryPath )` (`/tmp/S906577/`) failed with **error 800** (unable to
create file). `Container.ReadFile` exists; MBS has no `Files.DeleteFile`
(`Files.Delete` does exist).

Probe run 2: .fmp12 export failed with 800 in the temp folder (which already
existed), in `Get ( DocumentsPath )` (`/opt/FileMaker/FileMaker Server/Data/Documents/`),
and in Documents with a `filelinux:` prefix. **The server will not export
.fmp12 from a script** -- the format, not the folder. Run 3 tries **Merge
(.mer)**, which keeps field names in its first row, so the device can still
import by matching names.

Probe run 3: **Merge export works under PSoS**, in both the temp folder and
Documents (error 0, 2,494 bytes for 83 Profiles). The file starts with a header
row of field names, values are quoted and comma-separated, encoding UTF-16
(`CharacterSet="Unicode"`). `Files.Delete` removes the files. `Container.ReadFile`
takes the path only -- a second argument is read as a mode.

Probe run 4: `MBS ( "Container.ReadFile" ; path )` under PSoS returns a
container named after the file (`probe_a.mer`, 2,494 bytes). **The server half
is proven**: export to Merge, read into a container, delete the file.

Note (DDR of `GasketsRockOffline_Sandbox`, 2026-10-09 12:46): runs 1-4 ran in
the **hosted offline sandbox copy** (its "Profiles" layout, 83 records), not in
`GSR_Gaskets Rock_Sandbox`. The findings are about the server -- FMS 22.0.6 on
Linux, MBS 16.4 -- so they stand; the real `Build Route Export` still needs one
run in the data file. The offline sandbox copy has only `Admin` and `[Guest]`
accounts, so `Get ( AccountName )` cannot identify a tech today.

Device probe run 1: the OData read check returned 200, the script call 404
(`-1029 Script 'zProbe_RouteFile' not found`) -- the script had been pasted
into the offline copy, not the data file.

Device probe run 2 (FileMaker Pro 26.0.3 on the Mac, offline sandbox copy):
**the round trip works.** OData script call 200 in 397 ms; the server script
ran in `GSR_Gaskets Rock_Sandbox` (99 Profiles) as account `server`, returned a
2,968-byte Merge file as 3,960 chars of base64; decoded into
`Sync_Settings::zg_RouteFile`, exported to the temp folder, imported by field
name (UTF-16) with error 0 -- 99 rows; the 99 were then removed, 83 left.
Device probe run 3 (**FileMaker Go 26.0.3 on an iPad**): identical -- 200 in
335 ms, export error 0, import error 0, 99 rows, cleaned up to 83.

Still to see before building: a table with populated text (the Profiles text
fields are empty in sandbox data), ideally equipment notes with line breaks.

**The odata credential is the full-access `server` account.** Replace it with
the scoped `offline_field_app` account before distributing, and make the
route-export script executable only for that account.

1. ~~Export Records under PSoS~~ -- works as Merge, not as .fmp12 (runs 2-3).
2. ~~`MBS ( "Container.ReadFile" ; path )` under PSoS~~ -- works (run 4).
3. ~~Import Records from a .mer out of a container, by name, UTF-16~~ -- works
   in FileMaker Pro and FileMaker Go (device runs 2-3).
4. ~~How the device calls the server~~ -- the OData script endpoint with the
   `odata` credential, file returned as base64 in the script result. No
   hosted sign-in, no container fetch. Watch the result size for big routes.
5. **Timing** for the largest route, against the PSoS timeout.

## Decisions

- **Techs sign in with their own accounts in the offline file** (2026-10-09),
  named as their `Users::Account_Name`. The device sends `Get ( AccountName )`
  as the route-export parameter, exactly as `Initial Download` uses it. Spec in
  `ODATA_ACCOUNT.md`.
- **The device calls the server over the OData script endpoint** with the
  shared `odata` credential. The script result carries only a `RouteExports`
  key; the file comes down separately as the container's `$value`. (Sending the
  file as base64 in the result was proven for 99 Profiles but a full route
  exceeds the ~1 MB result limit -- run 2, 2026-10-15.)
