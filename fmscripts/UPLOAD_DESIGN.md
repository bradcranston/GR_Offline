# Upload path — design

The download half is solved: `Initial Download` pulls the tech's route into local
FileMaker tables. Nothing currently sends their work back. This is the design for
that return trip.

## What can change in the field

Only equipment. A tech adds, edits or deletes rows in `CUSTOMER_EQUIPMENT` for a
location. Locations, contacts, addresses, manufacturers and profiles are read-only
on the device — which keeps this a one-table sync and avoids most conflict work.

## The queue is the record itself

Rather than a separate queue table, mark the equipment rows:

| Field | Purpose |
|---|---|
| `f_pendingSync` | `1` while the row has local changes not yet accepted by the server |
| `z_syncAction` | `create` / `update` / `delete` |
| `z_localModTimestamp` | when the tech last touched it |
| `z_serverModTimestamp` | the `ModificationTimestamp` this row had at download |
| `z_syncError` | last rejection message, empty when clean |

A separate queue drifts out of step with the records it describes — a tech edits the
same item three times and you either write three queue rows or hand-merge them. Flags
on the record collapse that automatically: the row *is* the pending state.

Deletes are the exception, since the row is gone. Mark `z_syncAction = "delete"` and
keep the row hidden from the widget rather than actually deleting it; the row is
removed for real once the server confirms.

## Upload Changes

```
Set Error Capture [On]
$rows = ExecuteSQL ( "select \"__ID\" from \"CUSTOMER_EQUIPMENT\" where \"f_pendingSync\" = 1" )
Exit if empty -> "Nothing to upload."

Loop over $rows
    Go to the record
    If z_syncAction = "create"
        POST   {base}/CUSTOMER_EQUIPMENT           body = the row's fields
    Else If z_syncAction = "update"
        PATCH  {base}/CUSTOMER_EQUIPMENT('{__ID}')  body = changed fields only
    Else
        DELETE {base}/CUSTOMER_EQUIPMENT('{__ID}')
    End If

    Check Get(LastError) and the OData error payload
    On success -> clear f_pendingSync, z_syncAction, z_syncError
                  store the returned __ID and ModificationTimestamp
    On failure -> leave f_pendingSync set, write z_syncError, keep going
End Loop

Report: n uploaded, n failed -> back to the widget
```

Three details that matter:

**Keep going on failure.** One bad row must not strand the other forty. Collect
failures, report them at the end, leave those rows flagged for the next attempt.

**The server owns the key.** A row created in the field has a temporary id (the
widget already generates `__tempId`). The POST response carries the real `__ID`;
write it back to the local row so the next edit is an update rather than a second
create. This is the step that, if skipped, silently duplicates equipment.

**Uploads must be idempotent.** A response lost to a dropped connection looks
identical to a request that never arrived. Send a client-generated UUID with each
create and have the server treat a repeat as a no-op, so a retry after a timeout
can't create the row twice.

## Conflicts

Compare `z_serverModTimestamp` (what the row looked like at download) against the
server's current `ModificationTimestamp` before writing:

- unchanged on the server → apply the tech's edit
- changed on the server → do not overwrite; flag `z_syncError` and surface it

Last-write-wins is the wrong default here. A tech's gasket measurements taken at the
door are usually more current than an office edit — but not always, and silently
discarding either side is worse than asking. Surface the handful of conflicts and let
someone decide.

## What the widget needs

- `UploadChanges` — script, returns `{ uploaded, failed, conflicts:[…] }`
- `GetPendingCount` — script, drives a badge in the header
- A pending indicator per location in the list view, so the tech can see what's
  outstanding without opening each one
- The existing per-location "Sync Changes" button becomes a local commit (write the
  draft into `CUSTOMER_EQUIPMENT` with `f_pendingSync = 1`); a single "Upload" action
  handles the network

That last point is the significant change to what's built. Right now `SaveEquipmentList`
is treated as the sync boundary. It should be two steps: commit to the local table
(always works, offline included), then upload (needs a connection, retries).

## Order of work

1. Add the flag fields and make the widget's save write to the local table.
2. `GetPendingCount` + the pending badges — visible state before any network code.
3. `UploadChanges` for creates and updates only.
4. Deletes.
5. Conflict detection.

Steps 1–2 are worth doing on their own: they make the queue visible, which is what
stops a tech from wiping a day's work with a re-download.
