// -----------------------------------------------------------------------
// Folds the built widget into one self-contained HTML file.
// -----------------------------------------------------------------------
//   node ./scripts/inline-build        (run after `npm run build`)
//
// Parcel emits the stylesheet as a separate file and links to it with an
// absolute path. That is fine over http during `npm start`, but the
// deployed widget is loaded from a "data:text/html," URL inside the
// FileMaker web viewer, where there is no origin for that path to resolve
// against -- the link silently fails and the tech gets an unstyled page.
//
// So: replace every stylesheet link with the stylesheet itself, and refuse
// to write the file if anything external is left over.
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
const inPath = path.join(dist, "index.html");
const outPath = path.join(dist, "widget.html");

if (!fs.existsSync(inPath)) {
  console.error("\x1b[31mdist/index.html not found -- run `npm run build` first.\x1b[0m");
  process.exit(1);
}

let html = fs.readFileSync(inPath, "utf8");

// Inline <link rel="stylesheet" href="...">
html = html.replace(
  /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
  (match, href) => {
    const cssPath = path.join(dist, path.basename(href));
    if (!fs.existsSync(cssPath)) {
      console.error(`\x1b[31mStylesheet not found: ${href}\x1b[0m`);
      process.exit(1);
    }
    const css = fs.readFileSync(cssPath, "utf8");
    console.log(`  inlined ${path.basename(href)} (${css.length} bytes)`);
    return `<style>${css}</style>`;
  }
);

// Anything still pointing outward would 404 inside the web viewer.
const leftovers = [
  ...html.matchAll(/<link[^>]*href=["']([^"']+)["']/gi),
  ...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi),
  ...html.matchAll(/<img[^>]*src=["'](?!data:)([^"']+)["']/gi),
];
if (leftovers.length) {
  console.error("\x1b[31mExternal references remain -- the widget would break offline:\x1b[0m");
  leftovers.forEach((m) => console.error(`  ${m[1]}`));
  process.exit(1);
}

fs.writeFileSync(outPath, html);
console.log(
  `\x1b[32mWrote dist/widget.html (${html.length} bytes, self-contained)\x1b[0m`
);
