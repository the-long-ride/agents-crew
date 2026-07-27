# Local CLI Workers Source

## Mission

Invokes installed agent command-line tools using configured executables, fixed argument vectors, bounded environments, timeouts, and normalized result files.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | CLI worker construction, prompt/result file handling, child process execution, environment allowlisting, and normalization. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
