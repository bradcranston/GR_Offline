// -----------------------------------------------------------------------
// Minimal FileMaker script-step XML builders.
// -----------------------------------------------------------------------
// Every step ID used here was taken from a script exported out of this
// solution, so pasting the generated XML produces the intended steps. If
// you need a step type that isn't here, export a script containing it and
// copy its id rather than guessing -- a wrong id pastes a wrong step.
// -----------------------------------------------------------------------

const cdata = (s) => `<![CDATA[${s}]]>`;
const calc = (s) => `<Calculation>${cdata(s)}</Calculation>`;

// id 89 -- & and < escaped: a bare < in a comment ("account<tab>...") makes the
// snippet unparseable. > is left alone so existing output stays byte-identical.
const comment = (text = "") =>
  `<Step enable="True" id="89" name="# (comment)"><DisableStepCollapsed state="False"/><Restore state="False"/>${
    text ? `<Text>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Text>` : ""
  }</Step>`;

const banner = (text) => comment(`----------${text}---------- #`);

// id 141
const setVar = (name, value, rep = 1) =>
  `<Step enable="True" id="141" name="Set Variable"><DisableStepCollapsed state="False"/><Value>${calc(
    value
  )}</Value><Repetition>${calc(String(rep))}</Repetition><Name>${name}</Name></Step>`;

// id 86 / 85
const setErrorCapture = (on = true) =>
  `<Step enable="True" id="86" name="Set Error Capture"><Set state="${
    on ? "True" : "False"
  }"/><DisableStepCollapsed state="False"/></Step>`;

const allowUserAbort = (on = false) =>
  `<Step enable="True" id="85" name="Allow User Abort"><Set state="${
    on ? "True" : "False"
  }"/><DisableStepCollapsed state="False"/></Step>`;

// id 68 / 70
const ifStep = (condition) =>
  `<Step enable="True" id="68" name="If"><DisableStepCollapsed state="False"/><Restore state="False"/>${calc(
    condition
  )}</Step>`;
const elseStep = () =>
  `<Step enable="True" id="69" name="Else"><DisableStepCollapsed state="False"/><Restore state="False"/></Step>`;
const endIf = () => `<Step enable="True" id="70" name="End If"><DisableStepCollapsed state="False"/></Step>`;

// id 71 / 72 / 73
const loop = () =>
  `<Step enable="True" id="71" name="Loop"><DisableStepCollapsed state="False"/><Restore state="False"/><FlushType value="Always"/></Step>`;
const exitLoopIf = (condition) =>
  `<Step enable="True" id="72" name="Exit Loop If"><DisableStepCollapsed state="False"/>${calc(
    condition
  )}</Step>`;
const endLoop = () => `<Step enable="True" id="73" name="End Loop"><DisableStepCollapsed state="False"/></Step>`;

// id 6 -- layout id must match the file; FileMaker re-resolves by name on paste.
const goToLayout = (id, name) =>
  `<Step enable="True" id="6" name="Go to Layout"><DisableStepCollapsed state="False"/><LayoutDestination value="SelectedLayout"/><Layout id="${id}" name="${name}"/></Step>`;

// id 7 / 75
const newRecord = () =>
  `<Step enable="True" id="7" name="New Record/Request"><DisableStepCollapsed state="False"/></Step>`;
const commit = () =>
  `<Step enable="True" id="75" name="Commit Records/Requests"><NoInteract state="True"/><Option state="False"/><ESSForceCommit state="False"/><DisableStepCollapsed state="False"/></Step>`;

// id 9 -- confirmed from this file's own scripts.
const deleteRecord = () =>
  `<Step enable="True" id="9" name="Delete Record/Request"><NoInteract state="True"/><DisableStepCollapsed state="False"/></Step>`;

// id 147
const setFieldByName = (target, value) =>
  `<Step enable="True" id="147" name="Set Field By Name"><DisableStepCollapsed state="False"/><Result>${calc(
    value
  )}</Result><TargetName>${calc(target)}</TargetName></Step>`;

// id 28 -- criteria text of "$var" makes FileMaker evaluate the variable.
const performFind = (tableName, fieldId, fieldName, criteria) =>
  `<Step enable="True" id="28" name="Perform Find"><DisableStepCollapsed state="False"/><Restore state="True"/><Query><RequestRow operation="Include"><Criteria><Field table="${tableName}" id="${fieldId}" name="${fieldName}"/><Text>${criteria}</Text></Criteria></RequestRow></Query></Step>`;

// id 160
const insertFromURL = (urlVar, curlVar, targetVar) =>
  `<Step enable="True" id="160" name="Insert from URL"><NoInteract state="True"/><DontEncodeURL state="False"/><SelectAll state="True"/><DisableStepCollapsed state="False"/><VerifySSLCertificates state="False"/><CURLOptions>${calc(
    curlVar
  )}</CURLOptions>${calc(urlVar)}<Text/><Field>${targetVar}</Field></Step>`;

// id 160 into a field instead of a variable -- needed for binary downloads
// (a container's $value over OData). The field is matched by name on paste.
const insertFromURLToField = (urlVar, curlVar, field) =>
  `<Step enable="True" id="160" name="Insert from URL"><NoInteract state="True"/><DontEncodeURL state="False"/><SelectAll state="True"/><DisableStepCollapsed state="False"/><VerifySSLCertificates state="False"/><CURLOptions>${calc(
    curlVar
  )}</CURLOptions>${calc(urlVar)}<Text/><Field table="${field.table}" id="${field.id || 0}" name="${field.name}"/></Step>`;

// id 146
const setWebViewer = (objectNameCalc, urlCalc) =>
  `<Step enable="True" id="146" name="Set Web Viewer"><DisableStepCollapsed state="False"/><Action value="GoToURL"/><ObjectName>${calc(
    objectNameCalc
  )}</ObjectName><URL custom="False">${calc(urlCalc)}</URL></Step>`;

// id 62
const pause = (seconds) =>
  `<Step enable="True" id="62" name="Pause/Resume Script"><DisableStepCollapsed state="False"/><PauseTime value="ForDuration"/>${calc(
    String(seconds)
  )}</Step>`;

// id 87 -- NOT confirmed from an export of this file. Verify after pasting.
const showCustomDialog = (titleCalc, messageCalc) =>
  `<Step enable="True" id="87" name="Show Custom Dialog"><DisableStepCollapsed state="False"/><Title>${calc(
    titleCalc
  )}</Title><Message>${calc(messageCalc)}</Message></Step>`;

// id 87 with buttons. Buttons are listed left to right as FileMaker numbers
// them for Get ( LastMessageChoice ): the first is 1 and is the default, so
// put the safe choice first. Unused slots are emitted empty, as FileMaker does.
const showCustomDialogButtons = (titleCalc, messageCalc, buttons) =>
  `<Step enable="True" id="87" name="Show Custom Dialog"><DisableStepCollapsed state="False"/><Title>${calc(
    titleCalc
  )}</Title><Message>${calc(messageCalc)}</Message><Buttons>${[0, 1, 2]
    .map((i) =>
      buttons[i]
        ? `<Button CommitState="False">${calc(`"${buttons[i]}"`)}</Button>`
        : `<Button CommitState="False"/>`
    )
    .join("")}</Buttons></Step>`;

// id 182 -- format copied from a Truncate Table step in this file's DDR.
// Deletes every record in the base table with no dialog and no undo.
const truncateTable = (id, name) =>
  `<Step enable="True" id="182" name="Truncate Table"><NoInteract state="True"/><DisableStepCollapsed state="False"/><BaseTable id="${id}" name="${name}"/></Step>`;

// id 23
const showAllRecords = () =>
  `<Step enable="True" id="23" name="Show All Records"><DisableStepCollapsed state="False"/></Step>`;

// id 36. Formats seen in this client's files:
//   FMPR  FileMaker file -- from "Distributor - EXPORT 1 Order to GR". Does NOT
//         work under PSoS on this server: error 800 in every folder tried
//         (probe, 2026-10-09).
//   MRGE  Merge (.mer), tab delimiter -- from a step built by hand in
//         FileMaker. Carries field names in the first row, so the receiving
//         side can import by matching names.
// fields: [ { table, id, name } ] -- real ids, from the source file's DDR.
const EXPORT_FORMATS = {
  FMPR: `<Profile table="0" FieldDelimiter=" " IsPredefined="-1" FieldNameRow="0" DataType="FMPR"/>`,
  MRGE: `<Profile FieldDelimiter="&#09;" IsPredefined="-1" FieldNameRow="0" DataType="MRGE"/>`,
};
const exportRecords = (pathCalc, fields, format = "MRGE") => {
  if (!EXPORT_FORMATS[format]) throw new Error(`Unknown export format ${format}`);
  return `<Step enable="True" id="36" name="Export Records"><NoInteract state="True"/><CreateDirectories state="False"/><DisableStepCollapsed state="False"/><Restore state="True"/><AutoOpen state="False"/><CreateEmail state="False"/>${
    EXPORT_FORMATS[format]
  }<UniversalPathList>${pathCalc}</UniversalPathList><ExportOptions FormatUsingCurrentLayout="False" CharacterSet="Unicode"/><ExportEntries>${fields
    .map((f) => `<ExportEntry><Field table="${f.table}" id="${f.id}" name="${f.name}"/></ExportEntry>`)
    .join("")}</ExportEntries></Step>`;
};
const exportRecordsFMP = (pathCalc, fields) => exportRecords(pathCalc, fields, "FMPR");

// id 132 -- base format from the GSR sandbox DDR, which exports whatever field
// is active. Naming the field here is the new part: verify after pasting that
// the step shows it. id 0 is resolved by name on paste.
const exportFieldContents = (field, pathCalc) =>
  `<Step enable="True" id="132" name="Export Field Contents"><CreateDirectories state="False"/><DisableStepCollapsed state="False"/><AutoOpen state="False"/><CreateEmail state="False"/><UniversalPathList>${pathCalc}</UniversalPathList><Field table="${field.table}" id="${field.id || 0}" name="${field.name}"/></Step>`;

// id 35 -- format from "Distributor - IMPORT Order(s) from a Distributor" in the
// GSR sandbox DDR, switched to a Merge source (UTF-16, as the server writes it)
// with matching field names. fields are the target fields, in the source
// file's column order, so the map holds whether FileMaker matches by name or
// by position. Auto-enter is off: __ID and the server keys arrive as they are.
const importRecordsMerge = (pathCalc, table, fields, method = "Add") =>
  `<Step enable="True" id="35" name="Import Records"><NoInteract state="True"/><DisableStepCollapsed state="False"/><Restore state="True"/><VerifySSLCertificates state="False"/><DataSourceType value="File"/><Profile FieldDelimiter="&#09;" IsPredefined="-1" FieldNameRow="0" DataType="MRGE"/><UniversalPathList>${pathCalc}</UniversalPathList><ImportOptions CharacterSet="Unicode" KeepOriginalData="False" PreserveContainer="False" MatchFieldNames="True" AutoEnter="False" SplitRepetitions="False" method="${method}"/><Table id="${table.id}" name="${table.name}"/><TargetFields>${fields
    .map((f) => `<Field FieldOptions="0" map="Import" id="${f.id}" name="${f.name}"/>`)
    .join("")}</TargetFields></Step>`;

// id 10
const deleteAllRecords = () =>
  `<Step enable="True" id="10" name="Delete All Records"><NoInteract state="True"/><DisableStepCollapsed state="False"/></Step>`;

// id 22 / 28 without stored requests -- formats from the GSR sandbox DDR.
// Build requests in between with setFieldByName and newRecord.
const enterFindMode = () =>
  `<Step enable="True" id="22" name="Enter Find Mode"><DisableStepCollapsed state="False"/><Pause state="False"/><Restore state="False"/></Step>`;
const performFindCurrent = () =>
  `<Step enable="True" id="28" name="Perform Find"><DisableStepCollapsed state="False"/><Restore state="False"/></Step>`;

// id 74 -- format from the GSR sandbox DDR. onlyRelated + matchAll gives every
// record related to the whole found set, shown on the given layout.
const goToRelatedRecord = (table, layout, { onlyRelated = true, matchAll = true } = {}) =>
  `<Step enable="True" id="74" name="Go to Related Record"><Option state="${
    onlyRelated ? "True" : "False"
  }"/><MatchAllRecords state="${
    matchAll ? "True" : "False"
  }"/><ShowInNewWindow state="False"/><DisableStepCollapsed state="False"/><Restore state="True"/><LayoutDestination value="SelectedLayout"/><Table id="${table.id || 0}" name="${table.name}"/><Layout id="${layout.id}" name="${layout.name}"/></Step>`;

// Account steps -- formats from the GSR sandbox DDR ("Add New User",
// "Relogin", "Suspend - Activate User", "Delete User"). They need full access,
// so scripts using them are generated with runFullAccess.
// id 134
const addAccount = (nameCalc, passwordCalc, privilegeSet) =>
  `<Step enable="True" id="134" name="Add Account"><DisableStepCollapsed state="False"/><ChgPwdOnNextLogin value="False"/><AccountName>${calc(
    nameCalc
  )}</AccountName><Password>${calc(passwordCalc)}</Password><PrivilegeSet id="${privilegeSet.id || 0}" name="${
    privilegeSet.name
  }"/><AddAccount><AccountType>FileMaker</AccountType></AddAccount></Step>`;
// id 138. Without a name and password, it shows FileMaker's own login dialog.
const reLogin = (nameCalc, passwordCalc) =>
  nameCalc
    ? `<Step enable="True" id="138" name="Re-Login"><NoInteract state="True"/><DisableStepCollapsed state="False"/><AccountName>${calc(
        nameCalc
      )}</AccountName><Password>${calc(passwordCalc)}</Password></Step>`
    : `<Step enable="True" id="138" name="Re-Login"><NoInteract state="False"/><DisableStepCollapsed state="False"/></Step>`;
// id 137. operation: "Activate" | "Deactivate"
const enableAccount = (operation, nameCalc) =>
  `<Step enable="True" id="137" name="Enable Account"><DisableStepCollapsed state="False"/><AccountOperation value="${operation}"/><AccountName>${calc(
    nameCalc
  )}</AccountName></Step>`;
// id 135
const deleteAccount = (nameCalc) =>
  `<Step enable="True" id="135" name="Delete Account"><DisableStepCollapsed state="False"/><AccountName>${calc(
    nameCalc
  )}</AccountName></Step>`;

// id 111 -- format from the GSR sandbox DDR. No dialog; not forced to an
// external browser, so fmp:// URLs stay inside FileMaker.
const openURL = (urlCalc) =>
  `<Step enable="True" id="111" name="Open URL"><NoInteract state="True"/><Option state="False"/><DisableStepCollapsed state="False"/>${calc(
    urlCalc
  )}</Step>`;

// id 87 with input fields -- format from the GSR sandbox DDR.
// inputs: [ { table, id, name, label, password } ], at most three.
const showCustomDialogInput = (titleCalc, messageCalc, buttons, inputs) =>
  `<Step enable="True" id="87" name="Show Custom Dialog"><DisableStepCollapsed state="False"/><Title>${calc(
    titleCalc
  )}</Title><Message>${calc(messageCalc)}</Message><Buttons>${[0, 1, 2]
    .map((i) =>
      buttons[i]
        ? `<Button CommitState="${i === 0 ? "True" : "False"}">${calc(`"${buttons[i]}"`)}</Button>`
        : `<Button CommitState="False"/>`
    )
    .join("")}</Buttons><InputFields>${[0, 1, 2]
    .map((i) =>
      inputs[i]
        ? `<InputField UsePasswordCharacter="${inputs[i].password ? "True" : "False"}"><Field table="${
            inputs[i].table
          }" id="${inputs[i].id || 0}" name="${inputs[i].name}"/><Label>${calc(`"${inputs[i].label}"`)}</Label></InputField>`
        : `<InputField UsePasswordCharacter="False"><Field table="" id="0" name=""/></InputField>`
    )
    .join("")}</InputFields></Step>`;

// id 91 -- format from "Distributor - TRANSFER This Order to GR After Review" in
// the GSR sandbox DDR. Replaces the field in every record of the found set with
// the calculation, auto-enter off. field: { table, id, name } -- real id.
const replaceFieldContents = (field, valueCalc) =>
  `<Step enable="True" id="91" name="Replace Field Contents"><NoInteract state="True"/><DisableStepCollapsed state="False"/><Restore state="False"/><With value="Calculation"/>${calc(
    valueCalc
  )}<SerialNumbers PerformAutoEnter="False" UpdateEntryOptions="False" UseEntryOptions="True"/><Field table="${field.table}" id="${field.id}" name="${field.name}"/></Step>`;

// id 164 -- format from the GSR sandbox DDR. The script is matched by name on
// paste, so id 0 is fine as long as the target script exists first.
const performScriptOnServer = (scriptName, paramCalc, wait = true) =>
  `<Step enable="True" id="164" name="Perform Script on Server"><WaitForCompletion state="${
    wait ? "True" : "False"
  }"/><DisableStepCollapsed state="False"/>${calc(paramCalc)}<Script id="0" name="${scriptName}"/></Step>`;

// id 103
const exitScript = (result = null) =>
  `<Step enable="True" id="103" name="Exit Script"><DisableStepCollapsed state="False"/>${
    result ? `<Calculation>${cdata(result)}</Calculation>` : ""
  }</Step>`;

// id 1 -- script id is re-resolved by name on paste.
const performScript = (id, name) =>
  `<Step enable="True" id="1" name="Perform Script"><DisableStepCollapsed state="False"/><Script id="${id}" name="${name}"/></Step>`;
// id 1 with a parameter -- same shape as Perform Script on Server in the GSR
// DDR (parameter calculation before the script reference). Matched by name.
const performScriptWithParam = (name, paramCalc) =>
  `<Step enable="True" id="1" name="Perform Script"><DisableStepCollapsed state="False"/>${calc(
    paramCalc
  )}<Script id="0" name="${name}"/></Step>`;

// id 175
const performJS = (webviewerVar, functionName, params = []) =>
  `<Step enable="True" id="175" name="Perform JavaScript in Web Viewer"><ObjectName>${calc(
    webviewerVar
  )}</ObjectName><FunctionName>${calc(functionName)}</FunctionName><Parameters Count="${
    params.length
  }">${params.map((p) => `<P>${calc(p)}</P>`).join("")}</Parameters></Step>`;

// id 16 -- shape from another client's pasted script (StepText dropped).
const goToRecordFirst = () =>
  `<Step enable="True" id="16" name="Go to Record/Request/Page"><NoInteract state="False"/><RowPageLocation value="First"/></Step>`;
const goToRecordNextExit = () =>
  `<Step enable="True" id="16" name="Go to Record/Request/Page"><NoInteract state="False"/><Exit state="True"/><RowPageLocation value="Next"/></Step>`;

// Scripts the widget calls must never leave the Home layout: switching away
// unloads the web viewer, so the Perform JavaScript callback finds no "web"
// object and the widget waits until it times out, while the user is left
// on a sync layout. workWindow opens a card on the working layout -- the
// parent window and its web viewer stay put -- and callBack closes it (only
// if the current window is a card, so an early exit before it opened is
// harmless) before answering the widget. id 122 / 121, shapes from this
// account's other FileMaker files.
// Sized small (Height/Width shape from the GasketsRock DDR) so it reads as a
// "working" panel over the app rather than a full data layout: the card shows
// only the layout's top-left WORK_CARD area, which is where the sync layouts
// carry their status message. Freeze Window keeps the record work from
// redrawing it.
const WORK_CARD = { height: 140, width: 360 };
const workWindow = (layout) =>
  `<Step enable="True" id="122" name="New Window"><DisableStepCollapsed state="False"/><LayoutDestination value="SelectedLayout"/><Height>${calc(
    String(WORK_CARD.height)
  )}</Height><Width>${calc(String(WORK_CARD.width))}</Width><NewWndStyles DimParentWindow="Yes" Toolbars="No" MenuBar="No" Style="Card" Close="No" Minimize="No" Maximize="No" Resize="No" Styles="3222274064"/><Layout id="${layout.id}" name="${layout.name}"/></Step>\n<Step enable="True" id="79" name="Freeze Window"><DisableStepCollapsed state="False"/></Step>`;
// id 79 -- shape from other clients' pasted scripts.
const freezeWindow = () =>
  `<Step enable="True" id="79" name="Freeze Window"><DisableStepCollapsed state="False"/></Step>`;
const closeWindow = () =>
  `<Step enable="True" id="121" name="Close Window"><DisableStepCollapsed state="False"/><LimitToWindowsOfCurrentFile state="True"/><Window value="Current"/></Step>`;
const callBack = (webviewerVar = "$webviewer", functionName = "$callbackName", params = ["$promiseID", "$result"]) => [
  ifStep("Get ( WindowStyle ) = 3"),
  closeWindow(),
  endIf(),
  performJS(webviewerVar, functionName, params),
];

// Perform Find using the real field id harvested from the DDR (fieldIds.json).
// FileMaker does re-resolve by name on paste, but a placeholder id is one
// rename away from <Field Missing>.
let FIELD_IDS = {};
try {
  FIELD_IDS = require("./fieldIds.json");
} catch (e) {
  FIELD_IDS = {};
}
const findBy = (tableName, fieldName, criteria) => {
  const id = (FIELD_IDS[tableName] || {})[fieldName];
  if (!id) throw new Error(`No DDR field id for ${tableName}::${fieldName} -- add it to fieldIds.json`);
  return performFind(tableName, id, fieldName, criteria);
};

const wrap = (steps, { scriptName } = {}) =>
  scriptName
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">\n<Script includeInMenu="False" SiriShortcutVisible="False" runFullAccess="False" id="0" name="${scriptName}">\n${steps.join(
        "\n"
      )}\n</Script>\n</fmxmlsnippet>`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">\n${steps.join(
        "\n"
      )}\n</fmxmlsnippet>`;

module.exports = {
  comment,
  banner,
  setVar,
  setErrorCapture,
  allowUserAbort,
  ifStep,
  elseStep,
  endIf,
  loop,
  exitLoopIf,
  endLoop,
  goToLayout,
  goToRecordFirst,
  goToRecordNextExit,
  workWindow,
  freezeWindow,
  WORK_CARD,
  closeWindow,
  callBack,
  newRecord,
  deleteRecord,
  commit,
  setFieldByName,
  performFind,
  findBy,
  insertFromURL,
  insertFromURLToField,
  pause,
  exitScript,
  performJS,
  performScript,
  performScriptWithParam,
  setWebViewer,
  showCustomDialog,
  showCustomDialogButtons,
  truncateTable,
  showAllRecords,
  exportRecords,
  exportRecordsFMP,
  performScriptOnServer,
  exportFieldContents,
  importRecordsMerge,
  deleteAllRecords,
  replaceFieldContents,
  enterFindMode,
  performFindCurrent,
  goToRelatedRecord,
  addAccount,
  reLogin,
  enableAccount,
  deleteAccount,
  openURL,
  showCustomDialogInput,
  wrap,
};
