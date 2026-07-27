# Core Domain Model Modules

## Mission

This folder keeps the public orchestration data model readable and below the repository's 300-line Rust-file ceiling.

## Modules

| File | Responsibility |
| --- | --- |
| `common.rs` | Shared enums, capabilities, statuses, acceptance criteria, evidence, and test results. |
| `task.rs` | Task drafts, executable tasks, normalized worker results, and task helpers. |
| `run.rs` | Manager identity, approval requests, run state, and run construction. |
| `decision.rs` | Manager decisions, completion claims, and manager actions. |

`../model.rs` re-exports these types and owns the shared `CoreError` API.

## Editing rules

Keep serialization names stable unless intentionally changing the manager/worker protocol. Update JSON schemas whenever a serialized field or enum changes.
