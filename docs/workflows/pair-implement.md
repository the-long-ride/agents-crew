# Pair-Implement

Three-role workflow: implementer, pair reviewer, and optional verifier. The pair reviewer acts as a second set of eyes; the verifier provides final sign-off.

## Setup

1. Define participants: one `implementer`, one `pair`, and optionally one `verifier`.
2. Run `agents-crew init --workspace <root>`.
3. Run `agents-crew prepare --task task-input.json --json`.
4. Turn order: implementer → pair → verifier (if present).

## Failure

| Condition | Outcome |
|---|---|
| Pair reviewer returns `findings` | Workflow emits `needs_human` immediately (conflict) |
| Verifier returns non-`pass` status | Workflow emits `needs_human` |
| No verifier and pair passes | Workflow stops with `stop` |
| Adapter exits non-zero or times out | Adapter returns `needs_human` |
| Workspace lock already held | `acquireWorkspaceLock` throws |

## Example

```json
{
  "taskId": "db-migration-005",
  "goal": "Add nullable column to users table",
  "acceptanceCriteria": ["migration is reversible", "existing rows get default value"],
  "tests": [{ "command": "npx knex migrate:latest && npm test", "status": "passed", "summary": "ok" }],
  "implementationSummary": "New migration 20260629_add_nullable_col.js",
  "workflow": "pair-implement",
  "participants": [
    { "id": "impl-1",  "agent": "claude-code",      "role": "implementer" },
    { "id": "pair-1",  "agent": "opencode",         "role": "pair" },
    { "id": "verif-1", "agent": "github-copilot",   "role": "verifier" }
  ]
}
```

Commands:

```bash
agents-crew prepare --task task-input.json --json
agents-crew next    --json
agents-crew run     --participant pair-1 --json
agents-crew status  --json
```

State transitions:

```
(implementer) → READY → (pair review)
  → pass (no verifier)  → stop
  → pass (has verifier)  → (verifier)
    → pass → stop
    → fail → needs_human
  → findings → needs_human (conflict, no re-loop)
```
