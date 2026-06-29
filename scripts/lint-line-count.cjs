#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 500;
const srcDir = path.resolve(__dirname, '..', 'src');

const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const lines = fs.readFileSync(full, 'utf8').split('\n').length;
      const rel = path.relative(srcDir, full).replace(/\\/g, '/');
      if (lines > MAX_LINES) {
        violations.push({ file: `src/${rel}`, lines, max: MAX_LINES });
      }
    }
  }
}

walk(srcDir);

if (violations.length > 0) {
  for (const v of violations) {
    process.stderr.write(`FAIL ${v.file}: ${v.lines} lines (max ${v.max})\n`);
  }
  process.exit(1);
}

process.stdout.write(`PASS all source files <= ${MAX_LINES} lines\n`);
