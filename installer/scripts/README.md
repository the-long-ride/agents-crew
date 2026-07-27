# Installer Build Scripts

## Mission

This folder contains Node.js build helpers used to prepare the npm installer package.

## Files

- `write-build-metadata.mjs` embeds release repository and version metadata into the compiled installer.

## Editing rules

Build scripts must be deterministic and must not download or execute unverified release assets.
