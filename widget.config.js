module.exports = {
  widgetName: "GasketsRockField", // HTML::Name -- Startup loads this record
  server: "$",
  file: "GasketsRockOffline_Sandbox", // sandbox first; deploy-to-fm-live targets liveFile
  liveFile: "GasketsRockOffline_Sandbox",
  uploadScript: "UploadToHTML",
  reloadScript: "Load Widget",
  startDevScript: "Set to Dev Mode",
};
