# GitHub Copilot

Process-based adapter for GitHub Copilot CLI (`gh copilot` or `gh`). Spawns `gh` as a child process and parses the last line of stdout as structured review JSON.

## Setup

1. Install GitHub CLI (`gh`) and enable the Copilot extension.
2. Authenticate with `gh auth login`.
3. Ensure `gh` is on PATH, or override `command` in config.
4. Run `agents-crew init --workspace <root>`.
5. Prepare a task with a participant whose `agent` is `"github-copilot"`.

The adapter passes `--context` and `--schema` flags so the Copilot CLI reads the task context pack and outputs review JSON.

## Failure

| Condition | Behavior |
|---|---|
| `gh` executable not found | `spawnSync` error → `needs_human` |
| Process exits non-zero | Returns `needs_human` with stderr |
| Process times out | Returns `needs_human` |
| Last stdout line is not valid review JSON | Returns `needs_human` |
| JSON fails `validateCrewReview` | Returns `needs_human` |

## Example

Participant config:

```json
{
  "id": "gh-1",
  "agent": "github-copilot",
  "role": "verifier",
  "command": "gh",
  "args": [],
  "timeoutMs": 300000
}
```

Run:

```bash
agents-crew run --participant gh-1 --json
```
