# Core Domain Crate

## Mission

Contains host-neutral task, run, scheduler, DAG, controller, and verification contracts. It does not execute external tools.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
