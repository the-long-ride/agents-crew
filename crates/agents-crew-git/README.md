# Git Safety and Workspaces Crate

## Mission

Provides repository discovery, snapshots, scoped writes, task worktrees, patch export/application, and a current-worktree writer lock.

## Structure

- `Cargo.toml` declares crate dependencies and workspace metadata.
- `src/` contains the Rust implementation and has its own file map.

## Dependency rule

Depend only on lower-level contracts required for this mission; do not move orchestration into infrastructure crates.
