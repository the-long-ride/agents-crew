# Manager Host Integrations Crate

## Mission

Generates commands, agents, skills, rules, and ownership manifests for Codex, Claude Code, OpenCode, and Antigravity.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
