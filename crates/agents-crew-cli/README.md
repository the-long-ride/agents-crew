# Crew Command-Line Application Crate

## Mission

Composes configuration, state, policy, scheduling, workers, Git isolation, plugin generation, and the manager protocol into the `crew` binary.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
