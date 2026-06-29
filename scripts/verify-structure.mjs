#!/usr/bin/env node
import { resolve } from 'node:path';
import process from 'node:process';

import { collectViolations, formatViolations } from './check-file-lengths.mjs';

const root = resolve(process.argv[2] ?? process.cwd());
const violations = collectViolations(root);
if (violations.length > 0) {
  console.error(formatViolations(violations));
  process.exitCode = 1;
} else {
  console.log('Structure verified: all source files satisfy LOC limits.');
}
