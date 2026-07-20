#!/usr/bin/env node
/**
 * agent-pack
 * ----------
 * Turns a folder containing a manifest into a distributable .agent file.
 *
 *   node tools/pack.js example-agents/filesystem
 *   -> dist/filesystem.agent
 *
 * The first piece of the developer SDK: what an agent publisher runs before
 * submitting to the store.
 */

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const sourceDir = process.argv[2];
const outDir = process.argv[3] || path.join(process.cwd(), "dist");

if (!sourceDir) {
  console.error("Usage: node tools/pack.js <agent-folder> [output-folder]");
  process.exit(1);
}

const manifestPath = path.join(sourceDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No manifest.json found in ${sourceDir}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error(`manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

for (const field of ["id", "name", "version", "description"]) {
  if (!manifest[field]) {
    console.error(`manifest.json is missing required field: ${field}`);
    process.exit(1);
  }
}
if (!manifest.runtime || !manifest.runtime.type) {
  console.error("manifest.json must declare a runtime with a type.");
  process.exit(1);
}

const zip = new AdmZip();
zip.addLocalFile(manifestPath);

const iconPath = path.join(sourceDir, "icon.png");
if (fs.existsSync(iconPath)) zip.addLocalFile(iconPath);

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${manifest.id}.agent`);
zip.writeZip(outFile);

console.log(`Packed ${manifest.name} v${manifest.version} -> ${outFile}`);
