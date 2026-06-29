# Codex

Process-based adapter for OpenAI Codex CLI. Spawns `codex exec` in read-only sandbox mode and writes structured review output to a temporary JSON file.

## Setup

1. Install Codex CLI (`npm install -g @openai/codex` or equivalent).
2. Ensure `codex` is on PATH, or set `command` in config to the full path.
3. Run `agents-crew init --workspace <root>`.
4. Prepare a task with a participant whose `agent` is `"codex"`.

The adapter builds a prompt instructing Codex to review working-tree changes, read task context, and output structured JSON matching the supplied schema.

## Failure

| Condition | Behavior |
|---|---|
| `codex` executable not found | `spawnSync` error → `needs_human` |
| Process exits non-zero | Returns `needs_human` with stderr |
| Process times out (`timeoutMs` exceeded) | Returns `needs_human` |
| Output JSON fails `validateCrewReview` | Returns `needs_human` |
| Output file missing or unreadable | Throws; caught upstream |

## Example

Participant config:

```json
{
  "id": "codex-1",
  "agent": "codex",
  "role": "reviewer",
  "command": "codex",
  "args": [],
  "timeoutMs": 300000
}
```

Run:

```bash
agents-crew run --participant codex-1 --json
```
