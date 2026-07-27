# Durable Run State Crate

## Mission

Persists runs, append-only events, manager actions, context files, artifacts, and the latest-run pointer using atomic filesystem operations.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
