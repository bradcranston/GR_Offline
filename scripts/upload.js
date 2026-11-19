// -----------------------------------------------------------------------
// Pushes the built widget into the FileMaker file's HTML table.
// -----------------------------------------------------------------------
//   node ./scripts/upload        (run after `npm run build`)
//
// Opens an fmp:// URL that runs the file's UploadToHTML script, which finds
// (or creates) the HTML record whose Name is widgetName and reads the file
// at thePath into HTML::HTML. Startup loads the widget from that record.
//
// thePath must be dist/widget.html -- the inlined build -- never
// dist/index.html. index.html links its stylesheet as a separate file, and
// inside the web viewer's data: URL that link fails silently: the tech
// gets an unstyled page with no error anywhere.
// -----------------------------------------------------------------------

const fs = require("fs");
const open = require("open");
const path = require("path");
const config = require("../widget.config");

const { widgetName, uploadScript, server } = config;
// Sandbox by default -- nothing reaches the live master until it has run in
// the sandbox. `npm run deploy-to-fm-live` passes --live.
const file = process.argv.includes("--live") ? config.liveFile : config.file;

const thePath = path.join(__dirname, "..", "dist", "widget.html");
if (!fs.existsSync(thePath)) {
  console.error("\x1b[31mdist/widget.html not found -- run `npm run build` first.\x1b[0m");
  process.exit(1);
}

// A dev-server build left in dist/ carries Parcel's hot-reload client, which
// tries to reach localhost:1234 from the field device. Refuse to ship it.
if (fs.readFileSync(thePath, "utf8").includes("HMR_HOST")) {
  console.error(
    "\x1b[31mdist/widget.html is a dev-server build. Run `npm run clear-cache` and build again.\x1b[0m"
  );
  process.exit(1);
}

const params = { widgetName, thePath };
const url =
  `fmp://${server}/${file}?script=${uploadScript}&param=` +
  encodeURIComponent(JSON.stringify(params));

console.log(`Uploading ${path.relative(process.cwd(), thePath)} to ${file} :: HTML "${widgetName}"`);
open(url);
