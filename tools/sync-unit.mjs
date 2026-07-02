#!/usr/bin/env node
// Copy a unit folder into a target path (recursively, overwriting).
// The one primitive both local tests and the publish workflow share.
//
// Usage: node sync-unit.mjs <sourceDir> <targetDir>
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error("usage: sync-unit.mjs <sourceDir> <targetDir>");
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`source not found: ${source}`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`synced ${source} -> ${target}`);
