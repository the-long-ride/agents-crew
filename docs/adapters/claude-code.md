# Claude Code

Process-based adapter for Anthropic's Claude Code CLI. Spawns `claude` as a child process and parses the last line of stdout as a structured review JSON.

## Setup

1. Install Claude Code CLI and authenticate.
2. Ensure `claude` is on PATH, or override `command` in config.
3. Run `agents-crew init --workspace <root>`.
4. Prepare a task with a participant whose `agent` is `"claude-code"`.

The adapter passes `--context` and `--schema` flags so Claude Code reads the task context pack and outputs review JSON matching the schema.

## Failure

| Condition | Behavior |
|---|---|
| `claude` executable not found | `spawnSync` error → `needs_human` |
| Process exits non-zero | Returns `needs_human` with stderr |
| Process times out | Returns `needs_human` |
| Last stdout line is not valid review JSON | Returns `needs_human` |
| JSON fails `validateCrewReview` | Returns `needs_human` |

## Example

Participant config:

```json
{
  "id": "cc-1",
  "agent": "claude-code",
  "role": "implementer",
  "command": "claude",
  "args": [],
  "timeoutMs": 300000
}
```

Run:

```bash
agents-crew run --participant cc-1 --json
```
