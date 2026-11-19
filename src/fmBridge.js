// -----------------------------------------------------------------------
// FileMaker <-> WebViewer bridge
// -----------------------------------------------------------------------
// FileMaker -> JS
//   FileMaker calls global functions directly with data as the parameter,
//   e.g. via "Perform JavaScript in Web Viewer":
//     window.loadLocationList(jsonArrayString)
//     window.loadLocationDetail(jsonObjectString)
//   These are defined in index.js.
//
// JS -> FileMaker
//   Use performScript(scriptName, parameter) which returns a Promise that
//   resolves with whatever data the FileMaker script sends back.
//
//   The target FileMaker script must read the parameter with:
//     JSONGetElement ( Get ( ScriptParameter ) ; "callbackName" )
//     JSONGetElement ( Get ( ScriptParameter ) ; "promiseID" )
//     JSONGetElement ( Get ( ScriptParameter ) ; "parameter" )
//   ...and when finished, call back into the webviewer with:
//     Perform JavaScript In Web Viewer [ Function: $callbackName ; Parameters: $promiseID, $result ]
//   (see scripts/generate-script-steps.js for the exact step XML to paste
//   into a FileMaker script)
// -----------------------------------------------------------------------

const CALLBACK_NAME = "fmPromiseCallback";
const pending = new Map();
let counter = 0;

// A FileMaker script that never calls back leaves the promise pending
// forever, which on screen is an unexplained spinner. The commonest cause
// is the web viewer's "Allow JavaScript to perform FileMaker scripts"
// setting being off, in which case PerformScript is silently inert; a
// missing or renamed script does the same thing. Time out and say so.
const SCRIPT_TIMEOUT_MS = 20000;

// Parcel substitutes this at build time, so the dev-only sample data and
// mock never end up referenced by a deployed build.
const IS_DEV = process.env.NODE_ENV !== "production";

function isFileMakerAvailable() {
  return (
    typeof window.FileMaker !== "undefined" &&
    typeof window.FileMaker.PerformScript === "function"
  );
}

// FileMaker injects window.FileMaker into the web viewer *after* the page's
// scripts first run -- there is no event for it, and how long it takes
// varies by device. A single check at boot therefore reports "no FileMaker"
// on a perfectly good iPad, which sends the app down its browser-dev path
// looking for chunks a deployed build does not contain.
//
// So: poll briefly. Resolves true as soon as the object appears.
const FM_READY_TIMEOUT_MS = 5000;
const FM_READY_POLL_MS = 50;

let readyPromise = null;

function whenFileMakerReady() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (isFileMakerAvailable()) return resolve(true);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (isFileMakerAvailable()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - startedAt >= FM_READY_TIMEOUT_MS) {
        clearInterval(timer);
        resolve(false);
      }
    }, FM_READY_POLL_MS);
  });
  return readyPromise;
}

async function performScript(scriptName, parameter = {}) {
  const ready = await whenFileMakerReady();

  if (!ready) {
    if (IS_DEV) {
      const mod = await import("./devMock.js");
      return mod.mockPerformScript(scriptName, parameter);
    }
    throw new Error(
      "This web viewer can't reach FileMaker. Check that the web viewer has \"Allow JavaScript to perform FileMaker scripts\" enabled."
    );
  }

  return new Promise((resolve, reject) => {
    const promiseID = `p${Date.now()}_${counter++}`;

    const timer = setTimeout(() => {
      if (!pending.has(promiseID)) return;
      pending.delete(promiseID);
      reject(
        new Error(
          `FileMaker did not respond to "${scriptName}" within ${
            SCRIPT_TIMEOUT_MS / 1000
          }s. Check that the script exists and that the web viewer has "Allow JavaScript to perform FileMaker scripts" enabled.`
        )
      );
    }, SCRIPT_TIMEOUT_MS);

    pending.set(promiseID, { resolve, reject, timer });

    const payload = JSON.stringify({
      callbackName: CALLBACK_NAME,
      promiseID,
      parameter,
    });

    try {
      window.FileMaker.PerformScript(scriptName, payload);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(promiseID);
      reject(err);
    }
  });
}

// FileMaker calls this once the target script has finished, passing back
// the promiseID it was given along with the result data.
window[CALLBACK_NAME] = function (promiseID, result) {
  const entry = pending.get(promiseID);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(promiseID);

  let data = result;
  if (typeof result === "string") {
    try {
      data = JSON.parse(result);
    } catch (e) {
      // Leave as a raw string if it isn't valid JSON.
    }
  }

  if (data && typeof data === "object" && data.error) {
    entry.reject(new Error(data.error));
  } else {
    entry.resolve(data);
  }
};

// Fire-and-forget: asks FileMaker to run "Load Manufacturers", which is
// expected to call window.loadManufacturers(data) directly once ready
// (same FM->JS push convention as loadLocationList/loadLocationDetail).
async function requestManufacturers() {
  const ready = await whenFileMakerReady();
  if (!ready) {
    if (IS_DEV) {
      const mod = await import("./devMock.js");
      mod.mockLoadManufacturers();
    }
    return;
  }
  try {
    window.FileMaker.PerformScript("Load Manufacturers", "");
  } catch (err) {
    console.error(err);
  }
}

// Fire-and-forget: asks FileMaker to run "Load Gasket Profiles", which is
// expected to call window.loadProfiles(data) directly once ready (same
// FM->JS push convention as requestManufacturers above).
async function requestProfiles() {
  const ready = await whenFileMakerReady();
  if (!ready) {
    if (IS_DEV) {
      const mod = await import("./devMock.js");
      mod.mockLoadProfiles();
    }
    return;
  }
  try {
    window.FileMaker.PerformScript("Load Gasket Profiles", "");
  } catch (err) {
    console.error(err);
  }
}

export {
  performScript,
  isFileMakerAvailable,
  whenFileMakerReady,
  requestManufacturers,
  requestProfiles,
};
