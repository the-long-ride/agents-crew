# Configuration

Workspace configuration lives at `.agents-crew/config.toml`. `crew config validate` checks all fields before a run. Each run copies the resolved configuration to `crew.snapshot.toml`.

## Run

```toml
[run]
workspace_mode = "current" # or "isolated"
max_iterations = 8
max_parallel_readers = 4
max_parallel_writers = 2
max_tasks_per_iteration = 8
default_task_timeout_seconds = 900
retain_failed_worktrees = true
```

Current mode allows multiple readers but one writer. Isolated mode can run multiple writers in Git worktrees.

## Manager

```toml
[manager]
host = "claude-code"
alias = "Manager"
coding = "small_fixes" # never | small_fixes | full
small_fix_max_files = 3
small_fix_max_changed_lines = 120
```

## Permissions

Every value is `allow`, `ask`, or `deny`.

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

## Verification

```toml
[verification]
commands = [["npm", "run", "build"], ["npm", "test"]]
require_independent_review = true
allow_same_agent_review = false
```

## Workers

Common fields:

```toml
[[workers]]
id = "opencode-implementer"
alias = "OpenCode implementer"
kind = "cli" # native | cli | api
enabled = true
adapter = "opencode"
model = "configured-by-user"
model_fallback = "allow_host_default" # or deny
roles = ["implementer", "tester"]
capabilities = ["read", "write", "shell"]
priority = 80
args = []
env_allowlist = []
timeout_seconds = 900
requires_network = true
requires_credentials = true

[workers.headers]
```

CLI workers may set `command` and custom `args`. API workers require `provider`, `model`, and `api_key_env`; they must remain read-only.

Template precedence is workspace, then global, then built-in. Workspace templates live in `.agents-crew/templates`; global templates live in `$AGENTS_CREW_HOME/templates` or `~/.agents-crew/templates`.
