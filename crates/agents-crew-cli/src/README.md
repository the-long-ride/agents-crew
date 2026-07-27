# Crew Command-Line Application Source

## Mission

Composes configuration, state, policy, scheduling, workers, Git isolation, plugin generation, and the manager protocol into the `crew` binary.

## Files

| Path | Responsibility |
| --- | --- |
| `main.rs` | Tokio entry point, CLI parse, JSON/text output, and process exit behavior. |
| `args.rs` | Clap command and argument definitions. |
| `app.rs` | Top-level command dispatcher and orchestration module wiring. |
| `output.rs` | Stable JSON/text response rendering. |
| `app/` | Focused orchestration modules; see `src/app/README.md`. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
