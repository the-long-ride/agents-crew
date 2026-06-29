# Implement-Review

Two-agent workflow: one implementer writes code, one reviewer inspects it. Loops until the reviewer passes or a cycle limit is hit.

## Setup

1. Define at least two participants: one with role `implementer`, one with role `reviewer`.
2. Run `agents-crew init --workspace <root>` to create `.agents-crew/`.
3. Run `agents-crew prepare --task task-input.json --json` to write `TASK.json` and `READY.json`.
4. The implementer agent starts work; when it signals completion the system calls `agents-crew next` to route to the reviewer.

## Failure

| Condition | Outcome |
|---|---|
| Reviewer returns `findings` and `reviewCycle >= 3` (default limit) | Workflow emits `needs_human` |
| Reviewer returns `needs_human` | Workflow stops immediately with `needs_human` |
| Adapter process exits non-zero | Adapter returns `needs_human` |
| Adapter process times out | Adapter returns `needs_human` |
| Workspace lock already held | `acquireWorkspaceLock` throws; caller must resolve the stale lock |

## Example

```json
{
  "taskId": "auth-001",
  "goal": "Add rate-limiting middleware",
  "acceptanceCriteria": ["429 returned when limit exceeded", "existing tests pass"],
  "tests": [{ "command": "npm test", "status": "passed", "summary": "all green" }],
  "implementationSummary": "Token-bucket middleware in src/rate-limit.ts",
  "workflow": "implement-review",
  "participants": [
    { "id": "impl-1", "agent": "claude-code", "role": "implementer" },
    { "id": "rev-1",  "agent": "codex",       "role": "reviewer" }
  ]
}
```

Commands:

```bash
agents-crew prepare --task task-input.json --json
agents-crew next    --json
agents-crew run     --participant rev-1 --json
agents-crew status  --json
```

State transitions:

```
(implementer turn) → READY → (reviewer turn) → REVIEW
  → pass        → stop
  → findings    → back to implementer (cycle increments)
  → needs_human → stop, write NEEDS_HUMAN.md
```
