# Releasing

Tags publish native Rust archives through GitHub Releases and publish the TypeScript installer to npm.

## Required repository settings

- GitHub Actions must have permission to write repository contents.
- Add an `NPM_TOKEN` Actions secret with publish access to `@agents-crew/installer`.
- npm trusted publishing/provenance may be enabled for stronger release identity.

When `NPM_TOKEN` is absent, the workflow still publishes GitHub Release binaries and explicitly skips npm publishing.

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
```

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

The npm package contains TypeScript-generated JavaScript only. It chooses one release archive at install time; platform binaries are never embedded in the npm tarball.

## Create a release

1. Update `CHANGELOG.md`.
2. Set matching Cargo and installer versions.
3. Run:

   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --all-features -- -D warnings
   cargo test --workspace --all-features
   (cd installer && npm test && npm pack --dry-run)
   node scripts/verify-delivery.mjs
   ```

4. Commit and tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. Confirm all five archives and `SHA256SUMS` exist in the GitHub Release.
6. Test the published npm package on at least one clean repository:

   ```bash
   npx @agents-crew/installer@0.1.0 install --manager codex
   crew doctor --json
   ```

The workflow can also be dispatched manually for an existing tag.
