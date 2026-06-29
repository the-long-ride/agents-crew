# Same-Agent Loop

Single-agent workflow where one agent fills multiple roles (e.g., implementer then reviewer) in the same session. Requires distinct `conversationId` or `model` when the same agent kind and role repeat.

## Setup

1. Define participants that may share the same `agent` kind but must have distinct `id` values.
2. If two participants share the same `agent` and `role`, they must differ in `conversationId` or `model`.
3. Run `agents-crew init --workspace <root>`.
4. Run `agents-crew prepare --task task-input.json --json`.
5. The workflow validates the participant list before starting; invalid configurations are rejected.

## Failure

| Condition | Outcome |
|---|---|
| Duplicate `id` values | `validateTask` returns `{ ok: false }` |
| Same agent + role + conversationId + model | `validateTask` returns `{ ok: false, reason }` |
| Reviewer/verifier returns `findings` | Routes back to implementer |
| Reviewer/verifier returns `pass` | Workflow stops |
| Adapter exits non-zero or times out | Adapter returns `needs_human` |
| Workspace lock already held | `acquireWorkspaceLock` throws |

## Example

```json
{
  "taskId": "refactor-012",
  "goal": "Extract validation layer from controllers",
  "acceptanceCriteria": ["all existing tests pass", "no controller imports validation utils directly"],
  "tests": [{ "command": "npm test", "status": "passed", "summary": "green" }],
  "implementationSummary": "New src/validation/ module, controllers updated",
  "workflow": "same-agent-loop",
  "participants": [
    { "id": "impl-1",      "agent": "opencode", "role": "implementer", "conversationId": "conv-A", "model": "gpt-4o" },
    { "id": "rev-1",       "agent": "opencode", "role": "reviewer",    "conversationId": "conv-B", "model": "gpt-4o" },
    { "id": "impl-retry-1","agent": "opencode", "role": "implementer", "conversationId": "conv-A", "model": "o3" }
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
(implementer) → READY → (reviewer/verifier)
  → pass     → stop
  → findings → back to implementer
```
