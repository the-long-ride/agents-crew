# Durable Run State Source

## Mission

Persists runs, append-only events, manager actions, context files, artifacts, and the latest-run pointer using atomic filesystem operations.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Public state exports. |
| `store.rs` | RunStore persistence, action lifecycle, atomic writes, and tests. |
| `event.rs` | Persisted event and outstanding-action records. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
