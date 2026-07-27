#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tag = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`Invalid release version: ${process.argv[2] || ''}`);
const cargo = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
const cargoVersion = cargo.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/)?.[1];
const installer = JSON.parse(readFileSync(new URL('../installer/package.json', import.meta.url), 'utf8'));
assert.equal(cargoVersion, tag, `Cargo workspace version ${cargoVersion} does not match tag ${tag}`);
assert.equal(installer.version, tag, `Installer version ${installer.version} does not match tag ${tag}`);
console.log(`release versions match: ${tag}`);
