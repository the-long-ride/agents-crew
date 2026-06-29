# Agents Crew

Portable tooling for connecting AI agents to shared review loops, task handoff state, and workspace adapters.

## Install

```bash
npm install agents-crew
```

Requires Node.js >= 20.

## Using as an npm Package — Setting Up a Bridge

`agents-crew` manages review loops between AI agents. A **bridge** is a workspace where two or more agents collaborate on a task through structured state files and CLI commands.

### 1. Initialize the workspace

```bash
npx agents-crew init --workspace .
```

Creates `.agents-crew/` for runtime state.

### 2. Define a task draft

Create a JSON file describing the task and which agents participate:

```json
{
  "taskId": "add-redis-cache",
  "goal": "Add Redis caching to API routes",
  "acceptanceCriteria": ["Redis hit rate > 80%", "All existing tests pass"],
  "tests": [{ "command": "npm test", "status": "passed", summary: "ok" }],
  "implementationSummary": "Added Redis middleware in src/cache.ts",
  "workflow": "implement-review",
  "participants": [
    { "id": "impl-1", "agent": "claude-code", "role": "implementer" },
    { "id": "rev-1",  "agent": "codex",       "role": "reviewer" }
  ]
}
```

For a custom reviewer command, use the `process` adapter:

```json
"participants": [
  { "id": "impl-1", "agent": "claude-code", "role": "implementer" },
  { "id": "rev-1",  "agent": "process", "role": "reviewer", "command": "node", "args": ["my-reviewer.js"], "env": { "DEBUG": "1" } }
]
```

### 3. Prepare the task

```bash
npx agents-crew prepare --task task-input.json --json
```

This seals the current git diff hash into state, writes `TASK.json` and `READY.json`, and makes the task active.

### 4. Run participants

```bash
# Run a specific participant (e.g., the reviewer)
npx agents-crew run --participant rev-1 --json

# Or use the Antigravity hook for automated review on model stop:
echo '{"terminationReason":"model_stop","fullyIdle":true,"conversationId":"..."}' | npx agents-crew hook --adapter antigravity --json
```

- **Implementer** runs are allowed to change the working tree; the task snapshot is refreshed automatically.
- **Reviewer/verifier** runs reject if the diff changed mid-review (stale diff guard).
- Every run appends a turn to `TURNS.jsonl` and persists review state.

### 5. Advance the workflow

```bash
npx agents-crew next --json
```

Returns which participant should act next based on the workflow rules and last turn.

### 6. Check status

```bash
npx agents-crew status --json
```

### 7. Pause / resume automation

```bash
npx agents-crew disable --json   # stops hook from running
npx agents-crew enable --json    # re-enables
```

### Programmatic usage

```ts
import {
  validateCrewTaskDraft,
  validateCrewReview,
  createWorkflow,
  createAdapter,
  createStatePaths,
  JsonStateStore,
} from 'agents-crew';

const task = validateCrewTaskDraft({
  taskId: 'task-1',
  goal: 'Add caching layer',
  acceptanceCriteria: ['Redis hit rate > 80%'],
  tests: [{ command: 'npm test', status: 'passed', summary: 'green' }],
  implementationSummary: 'Added Redis middleware in src/cache.ts',
  workflow: 'implement-review',
  participants: [
    { id: 'impl-1', agent: 'claude-code', role: 'implementer' },
    { id: 'rev-1',  agent: 'codex',       role: 'reviewer' },
  ],
});

const workflow = createWorkflow('implement-review');
const decision = workflow.decideNext({ task, lastTurn });
```

### Legacy conversation IDs

If migrating from `agent-bridge` v1, `antigravityConversationId` in the task draft is automatically normalized to `conversationId`.

## State File Model

All runtime state lives under `.agents-crew/` in the workspace root.

| File | Purpose |
|---|---|
| `TASK.json` | Current task draft, git snapshot, review cycle counter |
| `READY.json` | Signal that a task is ready for the next participant |
| `REVIEW.json` | Latest review result |
| `TURNS.jsonl` | Append-only log of every participant turn |
| `CONTEXT.md` | Packed context for agent consumption |
| `LOCK.json` | Workspace lock (pid, taskId, participantId, createdAt) |
| `NEEDS_HUMAN.md` | Written when a workflow cannot resolve automatically |
| `DISABLED` | Sentinel file; presence disables all automation |

## Workflows

| Workflow | Roles | Description |
|---|---|---|
| `implement-review` | implementer → reviewer | Two-agent loop; reviewer passes or findings loop back (max 3 cycles) |
| `pair-implement` | implementer → pair → verifier? | Three-role pipeline; pair findings escalate immediately to human |
| `same-agent-loop` | any (same agent, different roles) | Single agent fills multiple roles; requires distinct conversationId or model per slot |

See [docs/workflows/](docs/workflows/) for full workflow documentation.

## Adapters

| Adapter | Mode | CLI Command | Notes |
|---|---|---|---|
| `antigravity` | Hook | — | Reads hook JSON from stdin; no child process |
| `codex` | Process | `codex` | Read-only sandbox; writes review JSON to temp file |
| `claude-code` | Process | `claude` | Parses last stdout line as review JSON |
| `opencode` | Process | `opencode` | Parses last stdout line as review JSON |
| `github-copilot` | Process | `gh` | Parses last stdout line as review JSON |

See [docs/adapters/](docs/adapters/) for per-adapter setup and configuration.

## Safety Model

- **Workspace locks** — `acquireWorkspaceLock` creates `.agents-crew/LOCK.json` with exclusive (`wx`) open; prevents concurrent participants from writing state simultaneously.
- **Diff hashing** — `prepare` snapshots the current `git diff` hash into `READY.json`; reviewers can detect if the tree changed mid-review.
- **Read-only review** — The Codex adapter runs in `--sandbox read-only` mode; process-based adapters receive context and schema but do not grant write access through the adapter itself.
- **Atomic writes** — All state files are written via temp-then-rename to avoid partial reads.

## Migration from `agent-bridge`

If your workspace previously used `agent-bridge` v1 with a `.agent-bridge/` directory:

```bash
npx agents-crew migrate agent-bridge-v1 --json
```

This copies `TASK.json`, `READY.json`, `REVIEW.json`, `NEEDS_HUMAN.md`, and `DISABLED` from `.agent-bridge/` into `.agents-crew/` (does not remove legacy files).

## Publish / Test Commands

```bash
npm test          # build + run all tests
npm run lint      # line-count check (<= 500 lines per file)
npm run test:coverage  # build + tests + text coverage report
npm run build     # compile TypeScript
npm run prepack   # build + test (runs before npm pack)
```
