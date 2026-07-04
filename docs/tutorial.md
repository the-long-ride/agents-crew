# Tutorial — Getting Started with agents-crew

This tutorial walks through setting up a two-agent review bridge from scratch. You'll have an implementer and reviewer collaborating on a task by the end.

## Prerequisites

- Node.js 20 or later
- A git repository with uncommitted changes to review
- Two AI agents (e.g., Claude Code and Codex) installed and available on PATH

## Step 1 — Install

```bash
npm install agents-crew
```

Or run directly with npx (no install needed):

```bash
npx agents-crew --help
```

## Step 2 — Set up a bridge

For example, to scaffold an implement-review workflow:

Run the `setup` command to scaffold everything in one step:

```bash
npx agents-crew setup \
  --workspace . \
  --workflow implement-review \
  --implementer claude-code \
  --reviewer codex \
  --task-id my-first-bridge \
  --goal "Fix the login redirect bug" \
  --json
```

This creates:
- `.agents-crew/` — runtime state directory
- `task-input.json` — a draft task file you can edit

If you prefer to be prompted interactively, just run:

```bash
npx agents-crew setup --workspace . --json
```

And answer the prompts for workflow, agents, task ID, and goal.

### One-step option: `--prepare`

If your goal and acceptance criteria are already clear, pass `--prepare` to scaffold
the bridge and seal the task into state in a single command (no separate prepare step):

```bash
npx agents-crew setup --workspace . --workflow implement-review \
  --implementer claude-code --reviewer codex \
  --task-id my-first-bridge --goal "Fix the login redirect bug" \
  --prepare --json
```

The output includes `"prepared": true` and a `status` block; you can then go straight to
`agents-crew run` / `agents-crew next`. To refine acceptance criteria or tests, edit
`task-input.json` and re-run `prepare`.

## Step 3 — Edit the task draft

Open `task-input.json` and refine it:

```json
{
  "taskId": "my-first-bridge",
  "goal": "Fix the login redirect bug",
  "acceptanceCriteria": [
    "User is redirected to /dashboard after login",
    "Existing tests pass"
  ],
  "tests": [
    { "command": "npm test", "status": "passed", "summary": "all green" }
  ],
  "implementationSummary": "Fixed redirect in src/auth/login.ts",
  "workflow": "implement-review",
  "participants": [
    { "id": "claude-code-implementer", "agent": "claude-code", "role": "implementer" },
    { "id": "codex-reviewer", "agent": "codex", "role": "reviewer" }
  ]
}
```

Key fields to fill in:

| Field | What to write |
|---|---|
| `acceptanceCriteria` | Measurable outcomes the reviewer will check |
| `tests` | Commands and their results (run them before preparing) |
| `implementationSummary` | A one-line summary of what was changed |

## Step 4 — Prepare the task

Prepare seals the current git diff into state so reviewers can detect changes:

```bash
npx agents-crew prepare --task task-input.json --json
```

You should see:

```json
{
  "enabled": true,
  "ready": true,
  "taskId": "my-first-bridge",
  "cycle": 0
}
```

## Step 5 — Run the reviewer

```bash
npx agents-crew run --participant codex-reviewer --json
```

The reviewer reads the task context and git diff, then returns one of:

| Status | Meaning |
|---|---|
| `pass` | No issues found. Workflow stops. READY.json is removed. |
| `findings` | Issues found. Review cycle increments; implementer gets another turn. |
| `needs_human` | Cannot resolve automatically. NEEDS_HUMAN.md is written. |

## Step 6 — Check status

At any time, check where things stand:

```bash
npx agents-crew status --json
```

This shows the enabled state, active task, and current review cycle.

## Step 7 — Advance the workflow

After a run, find out who goes next:

```bash
npx agents-crew next --json
```

For `implement-review`, if the reviewer found issues, it routes back to the implementer. If the reviewer passed, the workflow says stop.

## Step 8 — Handle review cycles

In `implement-review`, the implementer-reviewer loop repeats up to 3 cycles. After each implementer fix:

1. Run tests and update the task draft
2. Run `prepare` again to refresh the diff hash
3. Run the reviewer again

After 3 cycles with unresolved findings, the workflow writes `NEEDS_HUMAN.md` and stops.

## Step 9 — Pause and resume

If you need to temporarily stop automation (e.g., during a manual fix):

```bash
npx agents-crew disable --json
npx agents-crew enable --json
```

When disabled, hook commands return `stop` immediately.

## Handling failure

| Condition | What happens |
|---|---|
| Reviewer returns `findings` (cycle < 3) | Loops back to implementer |
| Reviewer returns `findings` (cycle >= 3) | Writes `NEEDS_HUMAN.md`, stops |
| Reviewer returns `needs_human` | Writes `NEEDS_HUMAN.md`, stops immediately |
| Process adapter exits non-zero | Returns `needs_human` |
| Git diff changes during review | Writes `NEEDS_HUMAN.md`, rejects the run |

When `NEEDS_HUMAN.md` appears, the workflow cannot resolve automatically. Read the file, fix the issue, then re-prepare.

## Using the Antigravity hook

If you use the Antigravity Desktop App, it can trigger automated reviews when an agent session ends. Configure your Antigravity hook to call:

```bash
echo '{"terminationReason":"model_stop","fullyIdle":true,"conversationId":"conv-123"}' \
  | npx agents-crew hook --adapter antigravity --json
```

The hook checks that:
- Automation is enabled
- A task is READY
- The agent session was idle and stopped normally
- The diff hasn't changed since preparation

If all checks pass, it runs the reviewer automatically.

## Using a custom reviewer script

Not all reviewers are built-in AI agents. You can use any command as a reviewer with the `process` adapter:

```json
{
  "participants": [
    { "id": "impl-1", "agent": "claude-code", "role": "implementer" },
    { "id": "rev-1", "agent": "process", "role": "reviewer", "command": "node", "args": ["scripts/my-linter.js"], "env": { "STRICT": "1" } }
  ]
}
```

The process must write a single JSON line to stdout matching the review schema:

```json
{"status":"pass","summary":"No issues","findings":[]}
```

Or with findings:

```json
{
  "status":"findings",
  "summary":"2 issues found",
  "findings":[
    {"severity":"high","file":"src/auth.ts","line":42,"title":"Missing null check","evidence":"user.email can be null","requiredFix":"Add null guard"}
  ]
}
```

## pair-implement workflow

Three-role pipeline for pair programming with verification:

```bash
npx agents-crew setup \
  --workspace . \
  --workflow pair-implement \
  --implementer claude-code \
  --pair-agent opencode \
  --verifier github-copilot \
  --task-id pair-task \
  --goal "Refactor the payment module" \
  --json
```

Flow: implementer codes → pair reviews → verifier signs off. If the pair reviewer finds issues, the workflow escalates to human immediately (no re-loop).

## same-agent-loop workflow

One agent fills multiple roles (e.g., self-review):

```json
{
  "workflow": "same-agent-loop",
  "participants": [
    { "id": "impl-1", "agent": "opencode", "role": "implementer", "conversationId": "conv-A", "model": "gpt-4o" },
    { "id": "rev-1",  "agent": "opencode", "role": "reviewer",    "conversationId": "conv-B", "model": "gpt-4o" }
  ]
}
```

Same-agent participants must differ in `conversationId` or `model` when they share the same agent kind and role.

## Monitoring state files

All runtime state lives in `.agents-crew/`:

| File | Watch for |
|---|---|
| `TASK.json` | Active task and review cycle |
| `READY.json` | Task is ready for the next participant |
| `REVIEW.json` | Latest review result |
| `TURNS.jsonl` | Full turn history (append-only) |
| `NEEDS_HUMAN.md` | Escalation — manual intervention needed |
| `LOCK.json` | Active workspace lock |
| `DISABLED` | Automation is off |

## Troubleshooting

| Problem | Solution |
|---|---|
| "READY.json does not match TASK.json" | Run `prepare` again after changing files |
| "Git diff changed during review" | The working tree changed while a reviewer was running; re-prepare the task |
| "Review limit reached" | Three review cycles exhausted; see NEEDS_HUMAN.md and fix manually |
| "No task is marked ready" | Run `prepare --task task-input.json` |
| Hook returns `stop` with "disabled" | Run `agents-crew enable --json` |
| Process adapter returns `needs_human` | The reviewer script exited non-zero or produced invalid JSON — check stderr |

## Quick reference

```bash
agents-crew setup        # Scaffold a bridge (interactive or with flags)
agents-crew setup --prepare  # Scaffold + prepare in one step
agents-crew init         # Create .agents-crew/ directory only
agents-crew prepare      # Seal a task into state
agents-crew run          # Run a participant
agents-crew next         # Who goes next?
agents-crew status       # Current workspace state
agents-crew hook         # Antigravity automated review trigger
agents-crew disable      # Pause automation
agents-crew enable       # Resume automation
agents-crew migrate      # Migrate from agent-bridge v1
agents-crew help         # Show overview or per-command help
```

All commands accept `--workspace <path>` (default: current directory) and `--json` for machine-readable output.
