# Direct API Workers Source

## Mission

Implements read-only worker adapters for OpenAI-compatible chat endpoints and the native Anthropic Messages API.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Provider configuration, bounded prompt construction, HTTP requests, response normalization, timeout handling, and secret-safe errors. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
