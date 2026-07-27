# Repository and Release Scripts

## Mission

This folder contains cross-language verification and release-packaging tools used locally and in CI.

## Files

- `verify-structure.mjs` enforces folder READMEs and the 300-line Rust ceiling.
- `verify-delivery.mjs` verifies installer/release contracts and expected assets.
- `verify-version.mjs` checks version consistency.
- `package-release.sh` packages Unix release binaries.
- `package-release.ps1` packages Windows release binaries.

## Editing rules

Scripts must fail loudly, avoid modifying source files during verification, and behave deterministically in CI.
