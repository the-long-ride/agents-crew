# Configuration Reference

Configuration lives at `.agents-crew/config.toml`.

`run.workspace_mode` selects `current` or `isolated`. Current mode permits concurrent read tasks but uses one repository writer lock. Isolated mode creates per-task worktrees and permits up to `max_parallel_writers` independent writers.

`manager.coding` is `never`, `small_fixes`, or `full`. Small fixes must fit both configured limits.

Each worker has a unique `id`, `kind`, roles, capabilities, priority, and optional model. API workers require `provider`, `model`, and `api_key_env`; write capability is rejected during validation.

CLI argument templates support `{model}`, `{prompt}`, `{workspace}`, and `{output}`. Environment variables are passed only when named in `env_allowlist`. CLI workers default to `requires_network = true` and `requires_credentials = true`; balanced mode therefore asks before invoking cloud-backed agent CLIs. Set either flag to `false` only when that transport truly does not need the guarded resource.


`autonomy.mode` is the selected preset label. The `[permissions]` table is authoritative at runtime. This allows a team to begin from balanced defaults and then tighten or relax individual operations explicitly.

Native workers use the manager host and may fall back to the host default model only when `model_fallback = "allow_host_default"`. CLI and API workers route by their configured model. A task can narrow routing with `preferred_workers`.

API workers are read-only and always require both network and credentialed-action approval when those permissions are set to `ask`. Their transport flags cannot weaken this requirement. Native workers set both transport requirements to false because their outer host controls its own network and credential sandbox.


## Worker transport flags

```toml
[[workers]]
id = "local-offline-reviewer"
kind = "cli"
adapter = "custom"
command = "./bin/local-reviewer"
roles = ["reviewer"]
capabilities = ["read"]
requires_network = false
requires_credentials = false
```

The flags describe transport prerequisites, not task permissions. A task still needs explicit `network`, `commit`, `push`, `deploy`, or `destructive` capabilities when it performs those operations.
