# Rust Workspace Crates

## Mission

This folder contains the Rust runtime as small crates with one dependency direction: infrastructure crates depend on core contracts, while the CLI composes everything.

## Crates

| Crate | Mission |
| --- | --- |
| `agents-crew-core` | Domain models, task graph, scheduler, controller, and verification rules. |
| `agents-crew-config` | TOML configuration model, defaults, loading, saving, and validation. |
| `agents-crew-state` | Durable run state, events, artifacts, and manager actions. |
| `agents-crew-workers` | Worker traits, routing contract, native bridge, and deterministic fake worker. |
| `agents-crew-cli-workers` | Safe adapters for installed local agent CLIs. |
| `agents-crew-api-workers` | Read-only direct API workers for supported provider protocols. |
| `agents-crew-git` | Git snapshots, scopes, worktrees, patches, and repository locking. |
| `agents-crew-policy` | Permission decisions for guarded operations. |
| `agents-crew-plugins` | Generated manager commands, agents, skills, and ownership manifests. |
| `agents-crew-prompts` | Embedded built-in role descriptions. |
| `agents-crew-cli` | User-facing `crew` binary and complete orchestration loop. |

## Editing rules

Keep each Rust source file at or below 300 physical lines and run `node scripts/verify-structure.mjs` after adding folders or modules.
