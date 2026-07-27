# CLI Orchestration Modules

## Mission

This folder decomposes the complete crew loop into focused modules while `../app.rs` remains the public command dispatcher.

## Modules

| File | Responsibility |
| --- | --- |
| `context.rs` | Configuration paths, loading, state-store creation, and run selection. |
| `setup.rs` | Project initialization, starter plans, default run construction, and run startup. |
| `engine.rs` | Worker router creation, scheduler loop, terminal-state decisions, and independent-review checks. |
| `task.rs` | Per-task dispatch, bounded context/result files, and external worker execution. |
| `routing.rs` | Workspace selection, retry fingerprints, and native worker selection. |
| `policy.rs` | Manager coding limits, capability permissions, transport permissions, and approval requests. |
| `outcome.rs` | Applies completed, failed, blocked, approval, and native-action outcomes to persisted runs. |
| `verification.rs` | Executes configured repository verification commands. |
| `control.rs` | Status, resume, recovery, pause/cancel, and approval decisions. |
| `admin.rs` | Doctor, config, plugin, and worker utility commands. |
| `manager.rs` | Manager protocol start/step/submit commands. |
| `native.rs` | Native workspace validation, patch integration, and manager change budgets. |
| `tests.rs` | Orchestration policy, recovery, retry, and review-separation tests. |

## Dependency rule

Modules communicate through `pub(super)` functions and shared types imported by `app.rs`. Keep the user-facing entry point in `app.rs` and avoid circular ownership between modules.

## Editing rules

Every module must remain at or below 300 physical lines. When a module approaches the limit, split by responsibility rather than compressing formatting.
