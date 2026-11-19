# Schema changes required

These must exist in `GasketsRockOffline` before `SaveEquipmentList` or the rewritten
`Initial Download` will run. All are on **CUSTOMER_EQUIPMENT** unless noted.

## Identity

| Field | Type | Auto-enter | Why |
|---|---|---|---|
| `__ID` | Text, indexed | `uID_CreateWithNoSpaces` | Stable identity for an equipment row |

The table currently has only `__kp_CustomerEquipment`, a numeric serial the server
assigns. That is too late: a row created in a walk-in cooler needs identity before it has
ever reached a server, or an upload retried after a dropped connection creates it twice.
Every other table in the file already has a text `__ID`, so this also makes
CUSTOMER_EQUIPMENT consistent with the rest of the schema.

**The generated field copies `Locations::__ID` exactly** — same auto-enter attributes,
same `uID_CreateWithNoSpaces` custom function — so it behaves like every other `__ID` in
the file rather than depending on a guess about the "do not replace existing value" flag.
`npm run generate-sync-fields` produces all six.

The widget now generates ids in the same format (uppercase base 36, 21 characters) rather
than dashed UUIDs. They are not structurally identical: `uID_Create` embeds a NIC address,
record id and timestamp, so `uID_ExtractTimestamp` and friends will not parse a
field-created id. Nothing reads those off equipment records today.

Existing rows need backfilling once:

```
Show All Records on an EquipmentSync layout
Replace Field Contents [ CUSTOMER_EQUIPMENT::__ID ; Get ( UUID ) ]   // "Replace with calculated result"
```

Do this **on the server copy first**, then re-download — otherwise each device invents its
own UUIDs for the same rows and nothing will ever match.

## Sync queue

Per `UPLOAD_DESIGN.md`, the pending-upload queue lives on the records themselves:

| Field | Type | Purpose |
|---|---|---|
| `f_pendingSync` | Number | `1` while the row has changes the server hasn't accepted |
| `z_syncAction` | Text | `create` / `update` / `delete` |
| `z_localModTimestamp` | Timestamp | When the tech last touched it |
| `z_serverModTimestamp` | Timestamp | `zzModifiedTimestamp` at download — for conflict detection |
| `z_lastDownload` | Timestamp | Stamped by `Initial Download` on every row the server returned; anything older is purged |
| `z_syncError` | Text | Last rejection message, empty when clean |

`Initial Download` refuses to run while `f_pendingSync = 1` rows exist, so this field is
also what stops a re-download from wiping a day's work.

## Purge and the environment guard

`Initial Download` stamps `z_lastDownload` on every equipment row the server returns,
then deletes local rows left with an older stamp — equipment deleted in the office no
longer lingers on every iPad. Rows with `f_pendingSync = 1` are never purged; the guard
at the top of the script already refuses to run while any exist, so this is the second
layer, and it is the one that stops a download destroying a day's work.

Locations are deliberately **not** purged. A location dropping off a route is far less
harmful than equipment that no longer exists, and deleting location records would cascade
through the equipment and contacts hanging off them.

`Initial Download` also writes the database it pulled from into
`Sync_Settings::DatabaseUUID`, and `UploadChanges` refuses to run when that does not
match the file's current target. `inSandbox` is
`PatternCount ( Get ( FileName ) ; "Sandbox" )` — it reflects the filename *now*, while
the data came down under whatever the filename was *then*. Without the check, renaming or
duplicating a file holding pending edits posts a tech's sandbox work into production, and
nothing tells you until someone notices bad data live.

## Layout

`EquipmentSync` must contain every field the scripts write, including the new ones —
`Set Field By Name` can only write fields present on the current layout.

## Both files

Every field here is needed in the **server's** `CUSTOMER_EQUIPMENT` as well as the offline
file. `Initial Download` copies fields across by name from the OData `$select`, and
`UploadChanges` sends `__ID` in the request body — a server table without that field
rejects the whole request.

## Calculations to fix

**`CUSTOMER_EQUIPMENT::asJSON`** must include `__ID`. Verified against the live file, it
currently emits 20 keys and no identifier of any kind, which is why an equipment row
cannot be matched on the way back in.

**The `"?"` values.** `asJSON` emits the literal string `"?"` where `JSONSetElement`
rejected a value -- empty date fields, mostly. Confirmed live on `Date_Gasket_Installed`,
`LastOrder`, `VisitLast` and `VisitNextDate`. It reaches the widget as data, so the
detail view renders "Last Order: ?" and the date input pre-fills with "?". Wrap those
elements so an empty field yields `""`:

```
JSONSetElement ( ... ; [ "Date_Gasket_Installed" ;
    If ( IsEmpty ( Date_Gasket_Installed ) ; "" ; GetAsText ( Date_Gasket_Installed ) ) ;
    JSONString ] )
```

The widget now strips a stray `"?"` on the way in as a stopgap, but the calculation is
where this belongs.

## Already present

`Sync_Settings` (layout id 4) already exists with `DatabaseUUID`, `Initialized`,
`LastSyncUTC` and `SyncVersion`. `Initial Download` now stamps `LastSyncUTC` there.

`ChangeDate_FM_to_JSON` already converts a FileMaker date to `YYYY-MM-DD`, so
`UploadChanges` uses it rather than hand-rolling the format.

**`inSandbox` can never be true in this file.** It is
`PatternCount ( Get ( FileName ) ; "Sandbox" )`, and the offline file is called
`GasketsRockOffline.fmp12`. Every generated script honours `inSandbox`, but testing
against the sandbox database means renaming a copy of the file to contain "Sandbox".

**There is no `Auth_Basic ( )` yet.** The house convention for a credential is a custom
function with a leading underscore returning a literal — `_AWSSecretKey`, `_GoogleAPIKey`
and seven others already do this. Following it keeps the OData credentials in one place
instead of eleven, which is the change worth making today. It is worth being clear that
it does not make them secret: anyone with the file can still read the function. Only a
read-only, route-scoped server account fixes that.

## Not changed

`_kf_Equipment` is `notEmpty` and numeric, so a row created in the field will fail
validation on commit unless it gets a value. Nothing in the widget supplies one. Decide
whether it should be optional for field-created rows, defaulted, or picked in the modal
before letting techs add equipment.

`Height` / `Width` (number) versus `heightEntry` / `widthEntry` (text) is unresolved —
techs measure in fractions, and the modal currently writes decimals to the number fields.
Left alone pending confirmation of how measurements are actually taken.
