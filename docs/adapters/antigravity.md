# Antigravity

Hook-based adapter for the Antigravity Desktop App. Does not spawn a child process; instead it listens for workspace hooks and decides whether to trigger review.

## Setup

1. Install Antigravity Desktop App and enable workspace hooks.
2. Create `.agents/hooks.json` in your workspace pointing to `agents-crew hook`.
3. Run `agents-crew init --workspace <root>`.
4. Prepare a task: `agents-crew prepare --task task-input.json --json`.

The adapter expects Antigravity to pipe JSON on stdin with `fullyIdle`, `terminationReason`, and `conversationId`.

## Failure

| Condition | Behavior |
|---|---|
| `fullyIdle !== true` | Returns `stop` — Antigravity still has active work |
| `terminationReason !== 'model_stop'` | Returns `stop` — review skipped for non-model stop |
| `conversationId` mismatch between hook and task | Throws error |
| No hook data on stdin | Defaults to empty object, likely returns `stop` |

## Example

Participant config:

```json
{
  "id": "ag-1",
  "agent": "antigravity",
  "role": "reviewer",
  "conversationId": "antigravity-conv-42"
}
```

Hook invocation:

```bash
echo '{"fullyIdle":true,"terminationReason":"model_stop","conversationId":"antigravity-conv-42"}' \
  | agents-crew hook --adapter antigravity --json
```
