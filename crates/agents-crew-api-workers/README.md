# Direct API Workers Crate

## Mission

Implements read-only worker adapters for OpenAI-compatible chat endpoints and the native Anthropic Messages API.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
