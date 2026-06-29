# OpenCode

Process-based adapter for OpenCode CLI. Spawns `opencode` as a child process and parses the last line of stdout as structured review JSON.

## Setup

1. Install OpenCode CLI.
2. Ensure `opencode` is on PATH, or override `command` in config.
3. Run `agents-crew init --workspace <root>`.
4. Prepare a task with a participant whose `agent` is `"opencode"`.

The adapter passes `--context` and `--schema` flags to OpenCode so it reads the task context pack and outputs review JSON.

## Failure

| Condition | Behavior |
|---|---|
| `opencode` executable not found | `spawnSync` error → `needs_human` |
| Process exits non-zero | Returns `needs_human` with stderr |
| Process times out | Returns `needs_human` |
| Last stdout line is not valid review JSON | Returns `needs_human` |
| JSON fails `validateCrewReview` | Returns `needs_human` |

## Example

Participant config:

```json
{
  "id": "oc-1",
  "agent": "opencode",
  "role": "reviewer",
  "command": "opencode",
  "args": [],
  "timeoutMs": 300000
}
```

Run:

```bash
agents-crew run --participant oc-1 --json
```
