# Embedded Role Prompts Source

## Mission

Embeds the Markdown role instructions into the Rust binary for project initialization and plugin generation.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Role-to-prompt lookup and completeness test. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
