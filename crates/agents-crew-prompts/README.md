# Embedded Role Prompts Crate

## Mission

Embeds the Markdown role instructions into the Rust binary for project initialization and plugin generation.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
