# Agents Crew

Agents Crew is a dependency-free TypeScript CLI for running a durable manager-and-workers AI agent loop across Codex, Claude Code, OpenCode, and Antigravity.

Only the manager host needs the plugin files. Workers can be native host agents, installed CLI tools, or read-only API models. The runtime owns task state, capability checks, approvals, retries, Git worktrees, verification evidence, and completion decisions.

## Requirements

- Node.js 22.13 or newer
- Git for repository discovery and isolated write worktrees
- At least one configured manager/native/CLI/API worker

No Rust toolchain, platform binary, package dependency, or post-install download is required.

## Install

From npm:

```bash
npm install --global @agents-crew/cli
crew --version
```

From this repository:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
npm link
crew --version
```

Both commands are installed:

- `crew` — preferred short command
- `agents-crew` — compatibility alias

## First setup

Inside a repository:

```bash
crew init --non-interactive
crew plugin install claude-code
crew doctor
```

Supported manager hosts:

```text
codex
claude-code
opencode
antigravity
```

`plugin install` generates only that host’s commands, manager instructions, and role agents. Generated files are tracked by `.agents-crew/plugin-manifests/<host>.json`, so doctor and uninstall can detect user edits.

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
```

Add `--json` anywhere for machine-readable output. Add `--workspace <path>` anywhere to target another repository.

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

Action IDs are one-time, capability-bounded, and expire after 24 hours. The manager must not invent IDs or claim completion before the runtime returns `completed`.

## Durable workspace

```text
.agents-crew/
├── config.toml
├── roles/
├── templates/
├── plugin-manifests/
├── active/<run-id>/
│   ├── run.json
│   ├── crew.snapshot.toml
│   ├── goal-<run-id>.md
│   ├── status.md
│   ├── status.json
│   ├── events.jsonl
│   ├── intent.json
│   ├── actions/
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

The UI binds only to `127.0.0.1`, serves bundled local assets, and requires a random per-launch API token embedded in the opened local URL. It has four views:

- **Builder** — compose a crew on a grab-to-pan, wheel-to-zoom graph with Fit and Reset controls. Edit hosts, models, roles, capabilities, network access, and credential requirements.
- **Templates** — browse built-in, global, and workspace templates in a data table and open them in Builder.
- **Runtime** — inspect and control active durable runs.
- **History** — inspect completed, cancelled, failed, and otherwise archived runs without active-run controls.

Host/model fields use a searchable custom combobox with centered SVG controls. Model choices are loaded for the selected adapter from the Models.dev catalog and limited to active models with text input and text output. OpenCode can use catalog models from every provider; Codex, Claude Code, and Antigravity receive their supported provider sets. Fresh cache remains usable for six hours, while stale or unavailable catalogs expose no selectable model IDs.

The header provides explicit dark and light modes. Every section has contextual help, and all buttons and text fields use square corners. Template saves are scoped to global or workspace storage. Request bodies are capped at 1 MiB. The UI has no CDN, remote fonts, analytics, frontend framework, or external browser dependency.

## Development

The repository uses pnpm 10 for development, while `npm link`, global installation, packing, and publishing remain supported:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
npm link
```

Full verification:

```bash
pnpm run check
```

Useful scripts:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run coverage
pnpm run pack:check
```

The build uses Node’s built-in TypeScript transform. The project intentionally has no `dependencies` or `devDependencies`. Runtime source is grouped by responsibility under `src/cli`, `src/config`, `src/domain`, `src/orchestration`, `src/runtime`, `src/templates`, `src/plugins`, `src/shared`, and `src/ui`; browser modules live under `ui/src`. Coverage thresholds apply to the shipped Node.js runtime under `dist/`. Browser modules run in the same test suite through focused model, markup, API, theme, viewport, and server tests; they are excluded from Node’s line-coverage denominator because the project has no browser coverage dependency.

## Release

Tagging `vX.Y.Z` runs `.github/workflows/release.yml`, verifies the root package version, runs the complete checks, creates one npm tarball, verifies and uploads that artifact to the GitHub Release, and publishes that exact `.tgz` to npm with provenance.

See [installation](docs/installation.md), [configuration](docs/configuration.md), [manager protocol](docs/manager-protocol.md), [security](docs/security.md), [local UI](docs/ui.md), [troubleshooting](docs/troubleshooting.md), and [releasing](docs/releasing.md).
