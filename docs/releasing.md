# Releasing

Agents Crew publishes the root package `@agents-crew/cli` to npm and attaches the same npm tarball to a GitHub Release.

## Prerequisites

- The npm account or organization owns the `@agents-crew` scope.
- npm trusted publishing is configured for `.github/workflows/release.yml`, or the repository has an `NPM_TOKEN` secret for bootstrap publishing.
- The release tag and `package.json` version match exactly.

## Prepare

```bash
npm version <patch|minor|major> --no-git-tag-version
npm run check
git add package.json CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin HEAD --tags
```

## Workflow

The release workflow:

1. Checks out the tag.
2. Uses Node.js 22 and installs npm CLI 11.5.1 or newer for trusted publishing.
3. Verifies `vX.Y.Z` equals the root package version.
4. Runs `npm run check`.
5. Runs `npm pack` and generates `SHA256SUMS`.
6. Creates or updates the GitHub Release and uploads the artifacts.
7. Downloads and publishes the exact `.tgz` produced in step 5, with public access and provenance.

The workflow can also be started manually with an existing v-prefixed tag.

## Local package inspection

```bash
npm run pack:check
npm pack --pack-destination ./dist
```

The packed package must include `dist/`, `roles/`, `schemas/`, documentation, license, and package metadata. It must not include Cargo files, Rust source, the former installer, tests, or temporary run state.
