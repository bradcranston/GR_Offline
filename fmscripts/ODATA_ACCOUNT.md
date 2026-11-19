# OData account for the offline file

The offline file talks to the hosted file over OData using one shared service account.
Create it on **both** hosted files (production and `GSR_Gaskets Rock_Sandbox`).

## Privilege set: `OfflineFieldApp`

**Extended privileges:** `fmodata` (Access via OData) only. No `fmapp`, no `fmrest`, no `fmwebdirect`.

**Records** (OData addresses base tables):

| Base table | View | Create | Edit | Delete | Why |
|---|---|---|---|---|---|
| `Locations` | yes | yes | yes | **no** | Techs edit and create locations; nothing deletes them |
| `CustomersEquipment` | yes | yes | yes | yes | Full equipment round trip |
| `Users` | yes | no | no | no | `Initial Download` reads `CustomersAssigned` for the tech |
| `Customers` | yes | no | no | no | Customer picker names |
| `Address` | yes | no | no | no | Download only |
| `CON_Contacts` | yes | no | no | no | Download only |
| `CONj_ContactsJoin` | yes | no | no | no | Download only |
| `ContactMethod` | yes | no | no | no | Download only |
| `MFG_Manufacturers` | yes | no | no | no | Download only |
| `Profiles` | yes | no | no | no | Download only |
| *all other tables* | no | no | no | no | |

Layouts, value lists and scripts: **none**, except for the server-side route
build (`SERVER_BUILD_DESIGN.md`): the route-export script must be
**Executable**, and the layouts it exports from need **view** access, because an
OData script call runs with this account's privileges. Proven with a probe
script on 2026-10-09 -- a script this account cannot run answers
`-1029 Script ... not found`, not a permission error.

Optional tightening: on `Locations`, limit **Edit** at field level to the fields
`UploadChanges` actually sends — `LocationName_Brand`, `LocationName_Identifier`,
`LocationName_Number`, `PhysicalAddress1/2`, `PhysicalCity`, `PhysicalState`,
`PhysicalZip`, `Comments`, `VisitNext`, `__ID`, `_kf_Customer`.

## Account

Name it something recognisable in logs, e.g. `offline_field_app`, with a long random
password. Rotate the old `server` password afterwards — it has been embedded in the offline
file's original `Initial Download` and has been in chat.

## Where the credential lives

In a `Credential` **table**, as record data — never in schema.

A DDR export captures calculations, auto-enter constants, value lists and script text, but
**not record contents**. Verified against this solution: no location name, record id or
manufacturer from the data appears anywhere in the offline file's DDR, while all 35
auto-enter constants do. So a credential written into a calculation, a field default or a
value list leaves the building every time someone exports a DDR; one held in a record does
not.

| Field | Holds |
|---|---|
| `Name` | `odata` |
| `Value` | `Base64EncodeRFC ( 4648 ; "offline_field_app:<password>" )` |
| `Note` | Which account this is, for whoever finds it later |

`_ODataAuth` (no parameters) reads it:

```
ExecuteSQL ( "select \"Value\" from \"Credential\" where \"Name\" = ?" ; "" ; "" ; "odata" )
```

Load the row into the **master copy** before distributing the file. Both `Initial Download`
and `UploadChanges` check it first and report "no server credentials" rather than failing
with a 401 that looks like a server outage.

This keeps the secret out of DDRs. It does **not** hide it from anyone holding the file,
who can open the record and read it — which is exactly why the account above reaches only
the field-app tables.

## One limitation worth knowing

It is a shared account, so every device can *read* every customer's locations over
OData, not just its own tech's route. `Initial Download` only *asks* for the tech's route.
Truly per-tech scoping would need a record-level calculation keyed to the tech, which a
shared account can't express. Acceptable for now; revisit if devices leave company control.

## Tech accounts in the offline file

Decided 2026-10-09: **each tech signs in to the offline file with their own
account.** This is separate from the OData account above, which stays shared.

`Initial Download` finds the route with `Get ( AccountName )`, and the server
route build will too, so the account name *is* the tech's identity:

- **Name** each account exactly as that tech's `Users::Account_Name` in the
  hosted file. A mismatch fails with "No customers are assigned to the account
  ...", which reads as a route problem, not a typo.
- **Privilege set `FieldTech`** (new, in the offline file):
  - Records: create / edit / delete in the synced tables -- they are local.
  - `Credential`: **view**. `_ODataAuth` reads it with ExecuteSQL, which obeys
    the signed-in account's privileges; without view access every download and
    upload stops with "no server credentials". No layout shows it.
  - Layouts: view only. Value lists: view only. Scripts: executable only.
  - Manage Database / Security / Extended Privileges: no.
  - Extended privileges: **`fmurlscript`** ("Allow URLs to perform FileMaker
    scripts") -- the widget calls FileMaker through `FileMaker.PerformScript`,
    which needs it; without it the web viewer cannot reach any script.
    Nothing else: `fmapp` is only for opening a *hosted* file, and the copy on
    the iPad is local.
- **File Options**: turn off any auto-login as `Admin`, so FileMaker Go asks
  for the tech's account. Go can keep the password in the iPad keychain.
- **`Admin`**: a strong password the techs never get. `Prepare for
  Distribution` and schema changes need it.

Things this choice brings with it:

- **Every copy carries every tech's account** unless copies are made per tech.
  A tech who knew a colleague's password could sign in as them on their own
  iPad. Per-tech copies (delete the other accounts before handing over) close
  that, at the cost of one master run per tech.
- **Passwords live in each copy.** Changing one means a new copy, or an admin
  editing the account on that device.
- **A new hire** needs an account in the master and a fresh copy.
