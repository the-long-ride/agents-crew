#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tag = (process.argv[2] || '').replace(/^v/u, '');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(tag)) throw new Error(`Invalid release version: ${process.argv[2] || ''}`);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(packageJson.version, tag, `package version ${packageJson.version} does not match tag ${tag}`);
console.log(`release version matches: ${tag}`);
