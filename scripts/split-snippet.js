#!/usr/bin/env node
// Splits a generated fmxmlsnippet Script into ScriptStep-only chunks small
// enough to hand to proofkit clipboard_write one at a time. Paste them in
// order into an empty script of the same name.
const fs = require("fs");
const path = require("path");
const [, , src, sizeArg] = process.argv;
if (!src) { console.error("usage: split-snippet.js <file.xml> [bytes]"); process.exit(1); }
const TARGET = Number(sizeArg || 25000);
const text = fs.readFileSync(src, "utf8");
const open = text.indexOf("\n", text.indexOf("<Script "));
const close = text.lastIndexOf("</Script>");
const body = text.slice(open + 1, close);
const steps = [];
let cur = [];
for (const ln of body.split("\n")) {
  if (ln === "") continue;
  cur.push(ln);
  if (ln.trimEnd().endsWith("</Step>")) { steps.push(cur.join("\n")); cur = []; }
}
if (cur.length) steps.push(cur.join("\n"));
const chunks = [];
let c = [], n = 0;
for (const s of steps) {
  if (c.length && n + s.length > TARGET) { chunks.push(c); c = []; n = 0; }
  c.push(s); n += s.length + 1;
}
if (c.length) chunks.push(c);
const name = path.basename(src, ".xml");
const dir = path.join(path.dirname(src), "chunks");
fs.mkdirSync(dir, { recursive: true });
// Files are never deleted here (the folder may disallow it); the _of_N suffix
// makes any leftovers from an earlier split unmistakable.
const hdr = '<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">\n';
chunks.forEach((ch, i) => {
  const p = path.join(dir, `${name}_${String(i + 1).padStart(2, "0")}_of_${String(chunks.length).padStart(2, "0")}.xml`);
  fs.writeFileSync(p, hdr + ch.join("\n") + "\n</fmxmlsnippet>");
  console.log(`${p}  ${ch.length} steps  ${fs.statSync(p).size} bytes`);
});
console.log(`TOTAL ${steps.length} steps in ${chunks.length} chunks`);
