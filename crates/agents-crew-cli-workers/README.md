# Local CLI Workers Crate

## Mission

Invokes installed agent command-line tools using configured executables, fixed argument vectors, bounded environments, timeouts, and normalized result files.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
