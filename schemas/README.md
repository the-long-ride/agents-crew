# JSON Protocol Schemas

## Mission

This folder defines machine-readable boundaries between the Rust core, manager host, and workers.

## Files

- `task.schema.json` validates delegated tasks.
- `worker-result.schema.json` validates normalized worker output.
- `manager-decision.schema.json` validates plans and review decisions.
- `manager-action.schema.json` validates actions issued to the manager host.
- `crew-state.schema.json` documents persisted run state.

## Editing rules

Schema changes are protocol changes. Update Rust models, host instructions, examples, and compatibility notes together.
