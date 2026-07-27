#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? process.cwd());
const MAX_RUST_LINES = 300;
const excludedDirectories = new Set([
  ".git",
  ".worktrees",
  ".agents-crew",
  "target",
  "node_modules",
  "dist",
  "coverage",
  ".cache",
  ".idea",
  ".vscode",
]);

const oversizedRustFiles = [];

function displayPath(absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

function physicalLineCount(text) {
  if (text.length === 0) return 0;
  const newlineCount = (text.match(/\n/g) ?? []).length;
  return newlineCount + (text.endsWith("\n") ? 0 : 1);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await walk(absolutePath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".rs")) continue;
    const text = await readFile(absolutePath, "utf8");
    const lines = physicalLineCount(text);
    if (lines > MAX_RUST_LINES) {
      oversizedRustFiles.push({ path: displayPath(absolutePath), lines });
    }
  }
}

const rootInfo = await stat(root);
if (!rootInfo.isDirectory()) {
  throw new Error(`Not a directory: ${root}`);
}

await walk(root);

oversizedRustFiles.sort((left, right) => right.lines - left.lines);

if (oversizedRustFiles.length > 0) {
  console.error(`Rust files over ${MAX_RUST_LINES} lines:`);
  for (const file of oversizedRustFiles) {
    console.error(`  - ${file.path}: ${file.lines} lines`);
  }
}

if (oversizedRustFiles.length > 0) {
  process.exitCode = 1;
} else {
  console.log(
    `Structure verified: every Rust file is <= ${MAX_RUST_LINES} lines.`,
  );
}
