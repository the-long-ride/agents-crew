# Core Domain Source

## Mission

Contains host-neutral task, run, scheduler, DAG, controller, and verification contracts. It does not execute external tools.

## Files

| Path | Responsibility |
| --- | --- |
| `model.rs` | Core error type and public re-exports for the domain model. |
| `model/` | Focused enums, task/result, run-state, and manager-protocol modules. |
| `dag.rs` | Dependency graph validation and readiness transitions. |
| `scheduler.rs` | Read/write batching under workspace concurrency rules. |
| `controller.rs` | Manager decision application and worker-result recording. |
| `verification.rs` | Evidence and acceptance-criterion validation. |
| `lib.rs` | Public exports and core error type. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
