# Releasing

Tags publish native Rust archives through GitHub Releases and publish the TypeScript installer to npmjs.com.

## Package ownership

The package name is `@agents-crew/installer`. Before the first publish, the npm account or organization doing the release must own the `@agents-crew` scope. If that scope is not available, change `installer/package.json`, installation examples, and delivery verification to a scope you control.

## First npm publish

Trusted publishing can only be configured after the package exists. Bootstrap the first release with one of these methods:

1. Publish once locally with an npm account that has two-factor authentication:

   ```bash
   cd installer
   npm install --ignore-scripts --no-package-lock
   npm run check
   npm publish --access public
   ```

2. Or create a granular npm automation token with publish access and add it to the GitHub repository as the `NPM_TOKEN` Actions secret. Push the matching release tag. The workflow uses the token as a fallback for this bootstrap release.

Before a local publish, set the package repository metadata to the real GitHub repository:

```bash
npm pkg set repository.type=git
npm pkg set "repository.url=git+https://github.com/OWNER/REPOSITORY.git"
npm pkg set "homepage=https://github.com/OWNER/REPOSITORY#readme"
npm pkg set "bugs.url=https://github.com/OWNER/REPOSITORY/issues"
```

The release workflow sets these fields automatically from `github.repository`.

## Enable npm trusted publishing

After the first package version exists:

1. Open `@agents-crew/installer` on npmjs.com.
2. Open **Settings → Trusted Publisher**.
3. Select **GitHub Actions**.
4. Enter the GitHub owner or organization and repository.
5. Set the workflow filename to `release.yml`.
6. Allow `npm publish`.
7. Save, run one tag release, then remove the `NPM_TOKEN` secret after OIDC publishing succeeds.

The publish job runs on a GitHub-hosted runner with Node.js 24 and `id-token: write`. npm provenance remains enabled. A configured `NPM_TOKEN` is only a fallback; the preferred steady-state setup is OIDC trusted publishing without a long-lived token.

## Required repository settings

- GitHub Actions must be allowed to create releases.
- Tag protection is recommended for `v*` tags.
- The npm trusted publisher repository and workflow filename must exactly match the GitHub repository and `release.yml`.
- For the bootstrap release only, `NPM_TOKEN` may be configured.

## Version contract

The same semantic version must appear in:

```text
Cargo.toml [workspace.package].version
installer/package.json version
Git tag v<version>
```

Verify locally:

```bash
node scripts/verify-version.mjs v0.1.0
node scripts/verify-delivery.mjs
node scripts/check-lint.mjs
node scripts/check-coverage.mjs
```

`node scripts/check-coverage.mjs` requires Node.js 22.8 or newer because it uses the built-in test-runner coverage thresholds. CI and release use Node.js 24. The published installer runtime still supports Node.js 20 or newer.

## Quality gates

The installer package provides:

```bash
cd installer
npm run lint
npm test
npm run coverage
npm run pack:check
npm run check
```

`npm run coverage` fails below 85% for lines, branches, or functions. `npm run check` runs lint, coverage, and a dry-run package inspection. The release workflow cannot publish until these checks and all Rust checks pass.

## Release assets

The release workflow builds:

```text
agents-crew-v<version>-x86_64-unknown-linux-gnu.tar.gz
agents-crew-v<version>-aarch64-unknown-linux-gnu.tar.gz
agents-crew-v<version>-x86_64-apple-darwin.tar.gz
agents-crew-v<version>-aarch64-apple-darwin.tar.gz
agents-crew-v<version>-x86_64-pc-windows-msvc.zip
SHA256SUMS
```

Every archive contains:

```text
crew[.exe]
agents-crew[.exe]
LICENSE
```

The npm package contains generated JavaScript, declarations, source maps, its README, and license. It chooses one release archive at install time; platform binaries are never embedded in the npm tarball.

## Create a release

1. Update `CHANGELOG.md`.
2. Set matching Cargo and installer versions.
3. Run:

   ```bash
   node scripts/check-lint.mjs
   cargo test --workspace --all-features
   node scripts/check-coverage.mjs
   node scripts/verify-delivery.mjs
   (cd installer && npm run pack:check)
   ```

4. Commit and tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. Confirm all five archives and `SHA256SUMS` exist in the GitHub Release.
6. Confirm the same version appears on npmjs.com.
7. Test the published package in a clean repository:

   ```bash
   npx @agents-crew/installer@0.1.0 install --manager codex
   crew doctor --json
   ```

The workflow can also be dispatched manually for an existing tag. The selected tag must still match both package versions.
