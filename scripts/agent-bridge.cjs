#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

if (!fs.existsSync(cliPath)) {
  process.stderr.write('Run npm run build before using scripts/agent-bridge.cjs\n');
  process.exitCode = 1;
} else {
  require(cliPath);
}
