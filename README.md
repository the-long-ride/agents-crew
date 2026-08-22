# Agents Crew

Agents Crew is a dependency-free TypeScript control plane for durable multi-agent work across Codex, Claude Code, OpenCode, and Antigravity. The core owns run state, policy, approvals, recovery, verification, and optional scheduling; registered AI agents can also coordinate directly through task leases, durable mailboxes, and optional A2A delivery without routing every interaction through the engine.

![Agents Crew Web UI Builder](https://raw.githubusercontent.com/the-long-ride/agents-crew/master/media/demo/Builder-Tab.png)

Only the manager host needs the plugin files. Workers can be native host agents, installed CLI tools, read-only API models, or peer agents participating through the agent mesh.

## Installation & Development Guide

For requirements, installation instructions, first setup, development guidelines, and release procedures, see [GUIDELINE.md](GUIDELINE.md).

## Core commands

```bash
crew init [--force] [--non-interactive]
crew ui [--port 4815] [--no-open]
crew start <template-id> --goal "..." [--expectation "..."] [--acceptance "..."] [--constraint "..."]
crew run <goal...>
crew plan <goal...>
crew status [run-id | --run run-id]
crew resume [run-id | --run run-id]
crew pause [run-id | --run run-id]
crew approve <approval-id> [--run run-id]
crew reject <approval-id> [--run run-id]
crew cancel [run-id | --run run-id]
crew doctor
crew config validate|show
crew template list|show|validate|delete
crew plugin list|install|doctor|uninstall
crew worker probe
crew worker run <worker-id> <task.json>
crew manager start --goal "..." --host <host>
crew manager step --run <run-id>
crew manager submit --run <run-id> --action <action-id> --result <result.json>
crew agent capabilities
crew agent register <agent-id> --provider <provider> --roles <csv> --capabilities <csv> [--a2a-url <url>]
crew agent list
crew agent heartbeat <agent-id>
crew agent claim <run-id> <task-id> <agent-id> [--lease-seconds 300]
crew agent release <run-id> <task-id> <agent-id> [--force]
crew agent send <run-id> <from-agent> <to-agent> --body "..." [--kind message|request|response|review|blocker] [--task <task-id>]
crew agent inbox <run-id> <agent-id>
```

Add `--json` anywhere for machine-readable output. JSON output never contains ANSI styling. Human output uses structured headings, indentation, status symbols, and ANSI color only when stdout/stderr is an interactive TTY; `NO_COLOR` disables color. Add `--workspace <path>` anywhere to target another repository.

## Agent mesh

An AI agent can discover the coordination protocol without starting or initializing the engine:

```bash
crew agent capabilities --json
```

Agents register a stable identity and capabilities, then can discover peers, claim/release tasks using leases, exchange messages, and inspect their inbox. These operations do not call the engine progression loop.

When a recipient registers an A2A endpoint, Agents Crew attempts A2A 1.0 JSON-RPC `message/send` first. The same message is still journaled to the durable local mailbox for audit and recovery. If direct delivery is unavailable or fails, mailbox delivery remains functional. A2A authorization values can be supplied by the TypeScript API as environment-variable references; secret values are never stored in registration files.

This makes the engine a coordination kernel rather than a mandatory communication relay. The existing manager protocol remains authoritative for planning, guarded execution, approvals, verification, retries, and completion.

## Manager loop

A host integration normally uses the explicit durable protocol:

```bash
crew manager start --goal "Implement the requested change" --host claude-code --json
crew manager step --run <run-id> --json
crew manager submit --run <run-id> --action <action-id> --result result.json --json
```

The manager must only execute actions returned by the runtime:

- `plan` — define acceptance criteria and bounded tasks
- `review` — recover or revise failed/interrupted work
- `dispatch_native` — execute one host-native role with an exact capability envelope
- `request_approval` — wait for a user decision
- `terminal` — display final state

Action IDs are one-time, capability-bounded, and expire after 24 hours. Peer messages and task leases do not require a manager action, but they cannot bypass these lifecycle/policy decisions.

## Durable workspace

```text
.agents-crew/
├── config.toml
├── roles/
├── templates/
├── plugin-manifests/
├── agents/<agent-id>.json
├── active/<run-id>/
│   ├── run.json
│   ├── crew.snapshot.toml
│   ├── goal-<run-id>.md
│   ├── status.md
│   ├── status.json
│   ├── events.jsonl
│   ├── intent.json
│   ├── actions/
│   ├── agents/claims/<task-id>.json
│   ├── communication/<agent-id>.jsonl
│   ├── artifacts/
│   ├── context/
│   └── tasks/
├── history/<run-id>/
└── worktrees/<run-id>/<task-id>/
```

Each run snapshots its resolved configuration. Resuming a run does not silently adopt later workspace or template edits.

## Configuration

`crew init` writes `.agents-crew/config.toml` with a manager-native starter worker. Example CLI workers:

```toml
[[workers]]
id = "opencode-implementer"
kind = "cli"
enabled = true
adapter = "opencode"
model = "configured-by-user"
roles = ["implementer", "tester"]
capabilities = ["read", "write", "shell"]
priority = 80
args = []
env_allowlist = []
requires_network = true
requires_credentials = true

[workers.headers]
```

Built-in adapters provide default invocations for `codex`, `claude-code`, `opencode`, and `antigravity`. Set `command` and `args` for custom CLIs. Supported placeholders are `{model}`, `{prompt}`, `{workspace}`, and `{output}`.

API workers are intentionally read-only:

```toml
[[workers]]
id = "read-only-reviewer"
kind = "api"
enabled = true
provider = "openai"
model = "configured-by-user"
api_key_env = "OPENAI_API_KEY"
roles = ["researcher", "reviewer"]
capabilities = ["read", "network"]
priority = 50
args = []
env_allowlist = []
requires_network = true
requires_credentials = true

[workers.headers]
```

Credential values are read from environment variables and never printed by doctor output.

## Permissions

Each guarded operation is configured as `allow`, `ask`, or `deny`:

```toml
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
```

The runtime checks the task envelope before dispatch, validates reported capabilities, rejects writable API workers, validates changed-file scope, serializes writers in current-workspace mode, and requires criterion-linked evidence before completion.

## Isolated worktrees

Set:

```toml
[run]
workspace_mode = "isolated"
```

Write tasks receive `.agents-crew/worktrees/<run>/<task>/`. Independent writers can execute in parallel. Their binary Git diffs are applied back to the main workspace and the temporary worktrees are cleaned after successful integration. Failed worktrees can be retained for inspection.

## Verification

Configure commands as arrays, avoiding shell interpolation:

```toml
[verification]
commands = [["npm", "test"], ["npm", "run", "build"]]
require_independent_review = true
allow_same_agent_review = false
```

Worker results must follow `schemas/worker-result.schema.json` and include capabilities used, tests, changed files, and evidence linked to acceptance criteria.

## Local UI

```bash
crew ui
```

The UI binds only to `127.0.0.1`, serves bundled local assets, and requires a random per-launch API token embedded in the opened local URL. It has five views:

- **Builder** — compose a crew on a grab-to-pan, wheel-to-zoom graph with Fit and Reset controls. Edit hosts, models, roles, capabilities, network access, and credential requirements.
- **Crews** — browse built-in, global, and workspace crew definitions in a data table and open them in Builder.
- **Connect** — install, check, repair, or disconnect Agents Crew wiring in the current user's global host scope for Codex, Claude Code, OpenCode, and Antigravity. Ownership manifests prevent Connect or Repair from seizing unrelated files.
- **Runtime** — inspect and control active durable runs plus Agents-Crew-managed worker subprocesses. Process controls provide safe Pause/Resume scheduling and managed Restart/Stop; Runtime never lists arbitrary operating-system processes.
- **History** — inspect completed, cancelled, failed, and otherwise archived runs without active-run controls.

Host/model fields use a searchable custom combobox with centered SVG controls. Model choices are loaded for the selected adapter from the Models.dev catalog and limited to active models with text input and text output. OpenCode can use catalog models from every provider; Codex, Claude Code, and Antigravity receive their supported provider sets. Fresh cache remains usable for six hours, while stale or unavailable catalogs expose no selectable model IDs.

The header provides explicit dark and light modes. Every section has contextual help, and all buttons and text fields use square corners. Template saves are scoped to global or workspace storage. Request bodies are capped at 1 MiB. The UI has no CDN, remote fonts, analytics, frontend framework, or external browser dependency.

See [guidelines](GUIDELINE.md), [installation](docs/installation.md), [configuration](docs/configuration.md), [manager protocol](docs/manager-protocol.md), [security](docs/security.md), [local UI](docs/ui.md), [troubleshooting](docs/troubleshooting.md), and [releasing](docs/releasing.md).
