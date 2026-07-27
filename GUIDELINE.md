# Contributor Guide

## Requirements

- Rust 1.86+
- Git
- Node.js 20+ for the installer
- TypeScript 5.8 for installer builds
- Python 3 for deterministic fake-agent fixtures

## Verify every change

```bash
cargo fmt --all
cargo clippy --workspace --all-targets --all-features
cargo build --workspace
cargo test --workspace
node scripts/verify-delivery.mjs
(cd installer && npm test && npm pack --dry-run)
```

Do not use real agent accounts or API credentials in blocking tests. Adapter tests must use fake executables. Provider HTTP tests should use local servers when added; never use live credentials in blocking tests.

## Crate boundaries

- `agents-crew-core`: domain model, DAG, scheduler, controller, verification.
- `agents-crew-config`: TOML model/defaults/validation.
- `agents-crew-state`: atomic run snapshots, action files, JSONL events.
- `agents-crew-workers`: transport-neutral worker trait, routing, native bridge.
- `agents-crew-cli-workers`: local process adapters.
- `agents-crew-api-workers`: read-only provider adapters.
- `agents-crew-git`: snapshots, locks, scopes, worktrees, patches.
- `agents-crew-policy`: permission and manager-authority decisions.
- `agents-crew-plugins`: generated host files and ownership manifests.
- `agents-crew-prompts`: embedded role instructions.
- `agents-crew-cli`: command wiring and foreground orchestration.

Core policy must not live only in a prompt. Add a Rust validation or policy check for every security or scheduling rule.

## Tests

Write behavior-first tests. Important cases:

- DAG cycle and transition rejection.
- Current-mode writer serialization.
- API write denial.
- Exact-model routing failure.
- Forged/stale native action rejection.
- Atomic snapshot recovery.
- Write-scope violations.
- Secret redaction.
- Generated-file ownership.
- Completion without evidence.

## Adapter changes

Agent CLIs evolve. Keep defaults small and configurable. Never concatenate a shell command. Use executable plus argument arrays. `probe` must report unsupported behavior instead of silently guessing.

## Plugin changes

All generated files must:

- contain no credentials;
- call the Rust CLI rather than duplicate orchestration logic;
- be listed with SHA-256 in the host manifest;
- survive ownership-safe doctor and uninstall tests.

## Release

1. Update `CHANGELOG.md` and keep Cargo, npm, and tag versions identical.
2. Run Rust, installer, and delivery-contract verification.
3. Push a `v<version>` tag.
4. Confirm five platform archives plus `SHA256SUMS` in GitHub Releases.
5. Confirm `@agents-crew/installer` was published with repository metadata and provenance.
6. Test `npx @agents-crew/installer install` and generated plugin doctor/uninstall in temporary repositories.
7. Generate the baseline-relative patch when requested.

See [docs/releasing.md](docs/releasing.md).
