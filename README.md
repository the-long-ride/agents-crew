# Agents Crew

Agents Crew is a Rust-first orchestration plugin for coding-agent teams.

Install the plugin into **one** manager host—Codex, Claude Code, OpenCode, or Antigravity. That manager can then plan, delegate, review, and loop across manager-native subagents, local coding-agent CLIs, and read-only model APIs. Worker tools do not need the Agents Crew plugin.

```text
one user goal
   ↓
installed manager host
   ↓ machine actions
agents-crew Rust core
   ├─ native subagents in the manager host
   ├─ Codex CLI
   ├─ Claude Code CLI
   ├─ OpenCode CLI
   ├─ Antigravity CLI/bridge
   ├─ OpenAI-compatible API
   └─ Anthropic Messages API
```

The model proposes work. The Rust core enforces state, task dependencies, worker eligibility, permissions, writer serialization, worktree isolation, retries, approvals, and completion evidence.

## Status

This repository is the Rust rewrite of the earlier Node review-loop package. The public architecture is implemented as a Cargo workspace. Real agent CLI behavior can change between releases, so adapter commands are configurable and `crew doctor` probes installed tools before a run.

## Install

### Recommended: npm installer

Run this from the repository that should receive the manager integration:

```bash
npx @agents-crew/installer install --manager claude-code
```

Choose `codex`, `claude-code`, `opencode`, or `antigravity`. The TypeScript installer downloads the matching Rust archive from GitHub Releases, verifies `SHA256SUMS`, installs both `crew` and the `agents-crew` compatibility command, initializes `.agents-crew/config.toml`, and generates files only for the selected manager.

Interactive selection is also supported:

```bash
npx @agents-crew/installer install
```

Binary-only installation:

```bash
npx @agents-crew/installer install --binary-only --yes
```

The default binary directory is `~/.agents-crew/bin`. Add it to `PATH` when the installer reports that it is missing. See [docs/installation.md](docs/installation.md).

### From source

```bash
cargo install --path crates/agents-crew-cli --bins
```

Rust 1.86 or newer is required only when building from source. End users of GitHub Release binaries do not need Rust.

## Start in one repository

```bash
cd /path/to/repository
crew init --non-interactive
crew plugin install claude-code
crew doctor --json
```

Then open the selected manager host and run:

```text
/crew-run Add request throttling to the API and verify it under load.
```

For hosts or terminals without slash-command support, use the universal fallback:

```bash
crew run "Add request throttling to the API and verify it under load."
```

Only the chosen manager gets generated plugin files. Codex, Claude Code, OpenCode, and Antigravity workers only need their normal CLI installation, or an API worker configuration. `agents-crew` remains an exact compatibility alias for scripts created before the `crew` command was introduced.

## What `/crew-run` does

A run has one durable ID and a terminal outcome: `completed`, `blocked`, `failed`, or `cancelled`.

1. Normalize the goal.
2. Create acceptance criteria.
3. Inspect repository context.
4. Build and validate an acyclic task graph.
5. Filter workers by role, capability, model, workspace, and priority.
6. Fan out safe read tasks.
7. Serialize write tasks in the current worktree, or isolate them in Git worktrees.
8. Collect normalized worker results.
9. Inspect actual Git changes and run independent verification commands.
10. On failure, request a manager review and retry only through a changed task, worker, model, instructions, or workspace strategy.
11. Reject completion until every criterion has passing evidence.

## Slash commands

The plugin generator creates the same semantic commands for all four manager hosts:

| Command | Purpose |
|---|---|
| `/crew-init` | Create configuration and built-in role prompts. |
| `/crew-run <goal>` | Execute the complete managed loop. |
| `/crew-plan <goal>` | Create a plan without implementation writes. |
| `/crew-status` | Show run, tasks, workers, approvals, and evidence. |
| `/crew-resume [run]` | Resume a paused or interrupted run. |
| `/crew-pause [run]` | Stop scheduling new tasks. |
| `/crew-approve <id>` | Approve one guarded action. |
| `/crew-reject <id>` | Reject one guarded action. |
| `/crew-cancel [run]` | Cancel the run. |
| `/crew-doctor` | Probe configuration, Git, plugins, workers, and credentials. |
| `/crew-config` | Explain or validate configuration. |

Host formats evolve independently. Generated files are isolated by host and tracked by a hash manifest. Run `crew plugin doctor <host>` after upgrading a host tool.

## Configuration

`crew init` creates `.agents-crew/config.toml`, built-in role files, and durable run directories.

```toml
version = 1

[run]
workspace_mode = "current" # current | isolated
max_iterations = 8
max_parallel_readers = 4
max_parallel_writers = 2
max_tasks_per_iteration = 8
default_task_timeout_seconds = 900
retain_failed_worktrees = true

[manager]
host = "claude-code"
coding = "small_fixes" # never | small_fixes | full
small_fix_max_files = 3
small_fix_max_changed_lines = 120

[autonomy]
mode = "balanced" # selected preset label; permissions below are authoritative

[permissions]
local_read = "allow"
local_edit = "allow"
test_commands = "allow"
network = "ask"
destructive_commands = "ask"
credentialed_actions = "ask"
commit = "ask"
push = "ask"
deploy = "ask"

[verification]
commands = [["cargo", "test", "--workspace"]]
require_independent_review = true
allow_same_agent_review = true # set false when a distinct reviewer worker is configured

[[workers]]
id = "codex-implementer"
kind = "cli"
adapter = "codex"
model = "configured-by-user"
roles = ["implementer", "tester"]
capabilities = ["read", "write", "shell"]
requires_network = true
requires_credentials = true
priority = 80

[[workers]]
id = "opencode-reviewer"
kind = "cli"
adapter = "opencode"
model = "configured-by-user"
roles = ["researcher", "reviewer"]
capabilities = ["read", "shell"]
requires_network = true
requires_credentials = true
priority = 70

[[workers]]
id = "native-reviewer"
kind = "native"
host = "manager"
model_fallback = "allow_host_default"
roles = ["reviewer", "researcher"]
capabilities = ["read"]
priority = 90

[[workers]]
id = "api-researcher"
kind = "api"
provider = "openai-compatible"
api_base_url = "https://api.example.com/v1"
api_key_env = "CREW_OPENAI_API_KEY"
model = "configured-model"
roles = ["planner", "researcher", "reviewer"]
capabilities = ["read"]
priority = 50
```

No model is permanently hard-coded. Set each worker model explicitly or allow the manager host default for a native worker.

`autonomy.mode` records the selected preset. The concrete `[permissions]` entries are the enforcement source of truth and may be customized independently.

### Worker transports

**Native** workers are subagents created inside the installed manager host. The core issues a one-time `dispatch_native` action. The host returns a normalized result. Forged, stale, reused, or capability-expanding submissions are rejected.

**CLI** workers execute a local process with argument arrays, a bounded prompt, a minimal environment, a timeout, a workspace, and a result path. Default adapters exist for `codex`, `claude`, `opencode`, and `antigravity`. Use `command` and `args` overrides when a local CLI version differs. CLI workers default to `requires_network = true` and `requires_credentials = true`, so balanced mode requests approval before invoking cloud-backed tools. Set both to `false` only for a verified offline/local CLI worker.

Arguments support these placeholders:

```text
{model} {prompt} {workspace} {output}
```

**API** workers support OpenAI-compatible Chat Completions and Anthropic Messages. They always require network and credential approval according to policy, regardless of optional CLI transport flags. They receive a bounded context pack containing the tracked-file map plus only task-selected file contents. They are read-only. They can research, plan, review, or recommend a patch, but they cannot directly modify the repository.

## Manager-native protocol

Generated slash commands use three machine commands:

```bash
crew manager start --goal "..." --host claude-code --json
crew manager step --run <run-id> --json
crew manager submit --run <run-id> --action <action-id> --result result.json --json
```

The manager must not invent task/action IDs or grant itself more capabilities. The core-issued action contains the role, task, model preference, fallback rule, workspace, context, output schema, and capability envelope.

A standalone `crew run` can execute CLI/API-only crews. If the selected task requires a native worker, it stops at `manager_required` so the installed host can continue it.

## Workspace modes

### Current worktree — default

- Uses the user's checked-out branch/worktree.
- Read-only tasks may run concurrently.
- Exactly one write-capable task runs at a time.
- A repository write lock covers the full write task.
- Git state is captured before and after the worker.
- Pre-existing user changes are separated from worker changes.
- Changed files must remain inside the task write scope.

This is best for normal interactive work and small crews.

### Isolated worktrees

```toml
[run]
workspace_mode = "isolated"
max_parallel_writers = 2
```

Each write task receives `.agents-crew/worktrees/<run>/<task>/` and a temporary branch. Independent writers can run in parallel. Results are exported as binary patches and integrated in dependency order. Failed worktrees are retained by default for inspection.

Use isolated mode when tasks are independent, changes are large, or concurrent writers are valuable.

## Manager coding authority

```toml
[manager]
coding = "never"       # manager only plans/reviews
coding = "small_fixes" # bounded emergency repairs
coding = "full"        # normal implementation tasks allowed
```

`small_fixes` enforces both file and changed-line limits for direct manager-role edits. Native implementer or integrator subagents remain worker roles and use their own core-issued capability envelopes and write scopes. The manager model cannot override either boundary.

## Balanced autonomy

Balanced mode allows local reads, scoped edits, and configured test commands. It pauses for:

- destructive commands;
- external network side effects;
- credentialed actions;
- commits;
- pushes;
- deployments.

Approval is explicit:

```bash
crew status --json
crew approve <approval-id> --json
crew resume --json
```

A model cannot implicitly approve its own side effect.

## Built-in roles

Role prompts ship in `roles/` and are copied to `.agents-crew/roles/` for customization:

- Manager
- Planner
- Researcher
- Implementer
- Tester
- Reviewer
- Integrator

Keep role prompts narrow. The best results come from bounded tasks, exact acceptance criteria, explicit write scopes, and independent review.

## Result contract

Every worker returns the same JSON shape:

```json
{
  "task_id": "implement",
  "status": "completed",
  "summary": "Implemented bounded request throttling.",
  "artifacts": [],
  "files_changed": ["src/http/rate_limit.rs"],
  "commands_run": [["cargo", "test"]],
  "capabilities_used": ["read", "write", "shell"],
  "tests": [],
  "evidence": [
    {
      "criterion_id": "goal",
      "source": "codex-implementer",
      "summary": "Implementation and tests completed.",
      "passed": true,
      "artifact": null
    }
  ],
  "assumptions": [],
  "blockers": [],
  "recommended_next_tasks": [],
  "metadata": {}
}
```

Worker claims do not complete a run. The core checks task ID, actual diff, write scope, test failures, criterion evidence, and the final task graph.

## Durable state and recovery

```text
.agents-crew/
  config.toml
  roles/
  locks/
  plugin-manifests/
  runs/<run-id>/
    run.json
    events.jsonl
    actions/*.json
    artifacts/
    context/
  worktrees/
```

Snapshots use temp-write, sync, and rename. Events are append-only with monotonic sequence numbers. Task state is persisted before worker launch. An interrupted `running` or `verifying` task is never silently rerun; resume creates a bounded manager review action so repository and worktree state can be inspected before replanning:

```bash
crew status --run <run-id> --json
crew resume --run <run-id> --json
```

## Plugin ownership

```bash
crew plugin list --json
crew plugin install opencode --json
crew plugin doctor opencode --json
crew plugin uninstall opencode --json
```

Install refuses to overwrite an unowned file unless `--force` is supplied. The manifest stores SHA-256 hashes. Uninstall deletes only unchanged generated files; modified files are preserved and reported.

## Security

- Credentials are named environment variables, never generated files.
- API workers receive only selected context.
- Worker environments are allowlisted and secrets are redacted from errors.
- Process adapters avoid shell expansion.
- API workers cannot write.
- Git-relative paths are checked against explicit write scopes; parent-directory scoped paths are rejected.
- Writes are checked against task scope.
- Destructive and external effects require explicit policy approval.
- Worker process timeouts cancel the process.

See [docs/security.md](docs/security.md).

## Recommended usage

1. Install into one manager host only.
2. Begin with two to four workers.
3. Give each worker a distinct role and explicit model.
4. Keep `workspace_mode = "current"` until tasks are clearly independent.
5. Keep balanced autonomy.
6. Configure real verification commands.
7. Use a different worker for final review when available; then set `allow_same_agent_review = false`.
8. Inspect `crew status` before approving commits, pushes, or deployments.
9. Run `crew doctor` after upgrading any agent CLI.
10. Treat `completed` as evidence-backed, not merely model-declared.

## Troubleshooting

### `manager_required`

A native worker was selected but no host bridge is active. Continue through the installed manager slash command or configure a CLI/API worker for that role.

### `no eligible worker`

Check role, capability, exact model, priority, transport health, and workspace constraints:

```bash
crew doctor --json
crew config validate --json
```

### CLI changed its arguments

Override `command` and `args` in the worker entry. Keep `{prompt}`, `{workspace}`, and `{output}` so the normalized contract still works.

### Modified plugin files

`plugin doctor` reports hash drift. Reinstall with `--force` only after reviewing local modifications.

### Run has no evidence

Add explicit criterion IDs to worker evidence and configure independent verification commands. Completion is intentionally rejected without passing evidence for every criterion.

More details: [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

```bash
node scripts/check-lint.mjs
cargo build --workspace
cargo test --workspace
node scripts/check-coverage.mjs
node scripts/verify-delivery.mjs
```

Repository structure rules are enforced in CI:

- Every maintained folder contains a local `README.md` explaining its mission.
- Every tracked Rust source file stays at or below 300 physical lines.
- Large responsibilities are split into focused modules rather than hidden behind oversized files.

CI uses deterministic fake-agent fixtures. Real CLIs and API credentials are optional local smoke tests only.

See [GUIDELINE.md](GUIDELINE.md) for contribution and manager-workflow guidance.
