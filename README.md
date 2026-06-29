# Agents Crew

Portable tooling for connecting AI agents to shared review loops, task handoff state, and workspace adapters.

## Install

```bash
npm install agents-crew
```

## CLI Quickstart

```bash
# Initialize workspace state directory
agents-crew init --workspace .

# Prepare a task from a JSON draft
agents-crew prepare --task task-input.json --json

# Advance the workflow to the next participant
agents-crew next --json

# Run a specific participant
agents-crew run --participant rev-1 --json

# Check workspace status
agents-crew status --json

# Disable / re-enable automation
agents-crew disable --json
agents-crew enable --json

# Migrate from agent-bridge v1
agents-crew migrate agent-bridge-v1 --json
```

## TypeScript API Quickstart

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
agents-crew migrate agent-bridge-v1 --json
```

This copies `TASK.json`, `READY.json`, `REVIEW.json`, `NEEDS_HUMAN.md`, and `DISABLED` from `.agent-bridge/` into `.agents-crew/` (does not remove legacy files).

## Publish / Test Commands

```bash
# Run all tests
npm test

# Run bridge-specific tests
npm run test:bridge

# Syntax-check the legacy CJS entrypoints
npm run check:bridge

# Build TypeScript
npm run build

# Build + test before packing
npm run prepack
```

## Current Scope

- `packages/agent-bridge-core/` owns the portable review-loop runtime.
- `scripts/agent-bridge.cjs` is the repo-level CLI entrypoint.
- `scripts/agent-bridge.ps1` is the Windows wrapper for local adapter use.
- `tests/` covers control commands, task preparation, hook processing, and package wiring.
- `docs/workflows/` workflow documentation.
- `docs/adapters/` adapter documentation.

## Supported Today

- Antigravity Desktop App via workspace-local hook and PowerShell wrapper.

## Planned Adapters

- Claude Code
- Codex CLI / IDE / Desktop
- OpenCode
- GitHub Copilot CLI / Desktop / IDE

## Layout

- `packages/agent-bridge-core/` portable runtime and schema
- `scripts/` repo entrypoints
- `tests/` bridge test suites
- `docs/antigravity/` Antigravity-specific workflow docs
- `docs/workflows/` workflow documentation
- `docs/adapters/` adapter documentation

## Antigravity Usage

Workspaces should keep their own local `.agents/hooks.json`, `.agents/rules/...`, and small wrapper entrypoint. Those files should delegate into this repo so the portable core stays in one place.

Recommended local wrapper behavior:

1. resolve sibling `agents-crew`
2. forward stdin and CLI args
3. pass the workspace root through `--workspace`

Common wrapper commands:

- `pwsh.exe -NoProfile -File scripts/agent-bridge.ps1 prepare --task <task-input.json> --json`
- `pwsh.exe -NoProfile -File scripts/agent-bridge.ps1 disable --json`
- `pwsh.exe -NoProfile -File scripts/agent-bridge.ps1 enable --json`
- `pwsh.exe -NoProfile -File scripts/agent-bridge.ps1 status --json`

Runtime state files:

- `.agent-bridge/READY.json`
- `.agent-bridge/REVIEW.json`
- `.agent-bridge/NEEDS_HUMAN.md`

## Verification

```bash
npm run test:bridge
node --check packages/agent-bridge-core/index.cjs
node --check scripts/agent-bridge.cjs
```
