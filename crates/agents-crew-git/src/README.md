# Git Safety and Workspaces Source

## Mission

Provides repository discovery, snapshots, scoped writes, task worktrees, patch export/application, and a current-worktree writer lock.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Public errors, snapshots, repository type, and module exports. |
| `repository.rs` | Git process operations and repository methods. |
| `path.rs` | Path containment, status parsing, hashing, and branch-safe identifiers. |
| `lock.rs` | Atomic repository writer lock lifecycle. |
| `tests.rs` | Path and write-scope unit tests. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
