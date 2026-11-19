// -----------------------------------------------------------------------
// Local browser dev fallback. When this app is opened outside of the
// FileMaker WebViewer (e.g. `npm start` in a normal browser), there is no
// window.FileMaker object to talk to. This module simulates FileMaker
// script responses using the sample JSON files so the UI can still be
// built and tested standalone.
// -----------------------------------------------------------------------
import detailData from "../detailLocationData.json";
import manufacturersData from "../manufacturers.json";
import profilesData from "../profiles.json";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Simulates FileMaker's "Load Manufacturers" script pushing data back via
// the window.loadManufacturers callback (see index.js).
export async function mockLoadManufacturers() {
  await delay(200);
  if (window.grSimulateOffline) return;
  window.loadManufacturers && window.loadManufacturers(manufacturersData);
}

// Simulates FileMaker's "Load Gasket Profiles" script pushing data back via
// the window.loadProfiles callback (see index.js).
export async function mockLoadProfiles() {
  await delay(200);
  if (window.grSimulateOffline) return;
  window.loadProfiles && window.loadProfiles(profilesData);
}

export async function mockPerformScript(scriptName, parameter) {
  await delay(200);

  // Dev aid: set window.grSimulateOffline = true in the console to make
  // every "FileMaker" call fail, so the offline/cached paths can be
  // exercised in a plain browser.
  if (window.grSimulateOffline) {
    throw new Error(`[dev mock] simulated offline: ${scriptName}`);
  }

  switch (scriptName) {
    case "GetLocationDetail": {
      // The dev mock only has one sample location's full detail, so it
      // returns that record regardless of which __ID was requested.
      return { ...detailData, __ID: parameter.__ID || detailData.__ID };
    }
    case "SaveEquipmentList": {
      console.info("[dev mock] SaveEquipmentList", parameter);
      const equipment = parameter.equipment || [];
      return {
        success: true,
        saved: equipment.length,
        created: equipment.filter((item) => item.isNew).length,
        deleted: 0,
        pendingCount: 2 + equipment.length,
        missing: [],
        equipment,
      };
    }
    case "GetLocationList": {
      const listData = await import("../listLocationData.json");
      return {
        locations: listData.default || listData,
        locationCount: (listData.default || listData).length,
        pendingCount: 2,
        needsDownload: false,
        customers: [
          { __kp_Customer: 2889, Customer_Name: "Smashburger" },
          { __kp_Customer: 3104, Customer_Name: "Bob Evans" },
        ],
      };
    }
    case "SaveLocation": {
      console.info("[dev mock] SaveLocation", parameter);
      const base = { ...detailData, ...parameter };
      base.Location_Name = [parameter.LocationName_Brand, parameter.LocationName_Identifier, parameter.LocationName_Number]
        .filter(Boolean)
        .join(" - ");
      return { success: true, created: Boolean(parameter.isNew), location: base };
    }
    case "UploadChanges": {
      console.info("[dev mock] UploadChanges");
      return { uploaded: 3, failed: 0, conflicts: [] };
    }
    case "DeleteEquipmentItem": {
      console.info("[dev mock] DeleteEquipmentItem", parameter);
      return { success: true };
    }
    default: {
      console.warn(`[dev mock] No mock handler for script "${scriptName}"`);
      return { success: true };
    }
  }
}
