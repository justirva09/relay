#!/usr/bin/env node
// patches the version field via regex instead of JSON.parse/stringify so it doesn't reformat the file
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/set-version.mjs <version>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function setJsonVersion(relPath) {
  const file = path.join(root, relPath);
  const raw = fs.readFileSync(file, "utf8");
  const updated = raw.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  fs.writeFileSync(file, updated);
}

function setCargoVersion(relPath) {
  const file = path.join(root, relPath);
  const raw = fs.readFileSync(file, "utf8");
  const updated = raw.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  fs.writeFileSync(file, updated);
}

setJsonVersion("package.json");
setJsonVersion("src-tauri/tauri.conf.json");
setCargoVersion("src-tauri/Cargo.toml");

console.log(`Version set to ${version} in package.json, tauri.conf.json, Cargo.toml`);
