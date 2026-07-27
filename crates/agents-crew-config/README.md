# Configuration Crate

## Mission

Defines `crew.toml`, starter defaults, load/save operations, permission values, worker routing entries, and configuration validation.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
