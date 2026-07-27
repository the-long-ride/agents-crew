# GitHub Actions Workflows

## Mission

This folder defines automated checks and release delivery for the project.

## Files

- `ci.yml` verifies repository structure, Rust formatting/lints/build/tests, and the TypeScript installer.
- `release.yml` builds platform binaries, creates checksums and archives, publishes GitHub Release assets, and publishes the npm installer.

## Editing rules

A workflow change must preserve Rust 1.78 compatibility, Node.js 20 support, and the five documented release targets.
