# Permission Policy Source

## Mission

Maps requested operations and manager coding limits to allow, ask, or deny decisions.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Policy engine, operation types, decisions, and focused tests. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
