# Worker Contracts and Routing Source

## Mission

Defines the worker trait, normalized request contract, routing behavior, native-manager bridge, and deterministic fake worker.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Public module exports. |
| `worker.rs` | Async worker trait and request model. |
| `router.rs` | Eligibility and priority routing. |
| `native.rs` | Manager-native dispatch action construction. |
| `fake.rs` | Deterministic in-process worker used by tests. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
