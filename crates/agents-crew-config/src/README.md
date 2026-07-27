# Configuration Source

## Mission

Defines `crew.toml`, starter defaults, load/save operations, permission values, worker routing entries, and configuration validation.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Public exports and configuration load/save entry points. |
| `model.rs` | Serializable configuration types and starter defaults. |
| `validate.rs` | Cross-field validation and configuration tests. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
