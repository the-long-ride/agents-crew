# Repository Scripts

## Mission

These scripts validate repository contracts and package native release artifacts.

## Commands

- `node scripts/verify-structure.mjs` checks local README coverage and Rust file size limits.
- `node scripts/verify-delivery.mjs` checks CLI, npm package, workflow, documentation, and release contracts.
- `node scripts/verify-version.mjs vX.Y.Z` checks Cargo, npm, and tag version alignment.
- `node scripts/check-lint.mjs` runs repository structure checks, Rust formatting and Clippy, and installer lint/type checks.
- `node scripts/check-coverage.mjs` runs installer tests with 85% line, branch, and function thresholds.
- `scripts/package-release.sh` packages Unix release binaries.
- `scripts/package-release.ps1` packages Windows release binaries.
