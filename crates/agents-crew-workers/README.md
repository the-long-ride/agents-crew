# Worker Contracts and Routing Crate

## Mission

Defines the worker trait, normalized request contract, routing behavior, native-manager bridge, and deterministic fake worker.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
