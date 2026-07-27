# GitHub Actions Workflows

## Mission

This folder defines automated checks and release delivery for the project.

## Files

- `ci.yml` verifies repository structure, Rust formatting/lints/build/tests, installer linting, installer tests, package contents, and the 85% coverage gates.
- `release.yml` repeats the quality gates, builds platform binaries, creates checksums and archives, publishes GitHub Release assets, and publishes the npm installer using npm trusted publishing with an optional bootstrap token fallback.

## Editing rules

A workflow change must preserve Rust 1.78 compatibility, Node.js 20 installer runtime support, Node.js 24 release publishing, the npm OIDC `id-token: write` permission, and the five documented release targets.
