# Protocol schemas

This folder defines machine-readable boundaries between the TypeScript runtime, manager host, and workers.

- `crew-state.schema.json` — durable run state
- `task.schema.json` — normalized task records
- `worker-result.schema.json` — worker submissions
- `manager-action.schema.json` — runtime-issued host actions
- `manager-decision.schema.json` — plan/review submissions

Schema changes are protocol changes. Update TypeScript types, validation, generated host instructions, examples, and compatibility notes together.
