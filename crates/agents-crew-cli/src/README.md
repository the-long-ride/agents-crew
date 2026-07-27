# Crew Command-Line Application Source

## Mission

Composes configuration, state, policy, scheduling, workers, Git isolation, plugin generation, and the manager protocol into the `crew` binary.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Shared CLI module ownership, argument parsing, output handling, and exit-code calculation. |
| `main.rs` | Primary `crew` Tokio entry point. |
| `bin/agents-crew.rs` | Compatibility `agents-crew` Tokio entry point using the shared runner. |
| `args.rs` | Clap command and argument definitions. |
| `app.rs` | Top-level command dispatcher and orchestration module wiring. |
| `output.rs` | Stable JSON/text response rendering. |
| `app/` | Focused orchestration modules; see `src/app/README.md`. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
