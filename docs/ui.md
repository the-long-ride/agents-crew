# Local UI

Start the control plane inside a repository:

```bash
crew ui
```

The server binds to `127.0.0.1` and generates a new launch token for every process. The token is added to the opened URL and sent on API requests. Static assets remain local and dependency-free. Use the header buttons to switch explicitly between dark and light themes.

## Builder

Builder loads resolved built-in, global, and workspace templates. The graph has no scrollbars: drag empty canvas space to pan, use the mouse wheel over the graph to zoom around the pointer, choose **Fit** to frame every node, or choose **Reset** to restore 100% zoom and the default origin. Worker nodes remain draggable in graph coordinates, so their saved positions are stable at every zoom level.

Select a manager or worker node to edit its alias, adapter or host, model, roles, capabilities, network requirement, and credential requirement. Worker nodes can be added and deleted. Host and model fields use the shared searchable combobox instead of native browser selects. Manual values remain valid.

For `codex`, `claude-code`, and `antigravity`, model suggestions come from the public Models.dev catalog without credentials. The server caches normalized results for six hours under `.agents-crew/cache/models-dev.json`, keeps stale cache available when refresh fails, and exposes a manual refresh action. Suggestions do not prove that a model is enabled for the current local account or plan.

Use the header scope selector to save to:

- `global` — reusable from any workspace for the current user
- `workspace` — stored in the current repository and takes precedence over a matching global ID

Built-in templates are read-only sources. Saving one creates a writable global or workspace template.

## Crews

Crews renders resolved records as a semantic data table with name, ID, scope, worker count, source path, and an Open action. Workspace records override matching global IDs; global records override matching built-ins.

## Connect

Connect manages Agents Crew integration at the current user's global host scope. It supports Codex, Claude Code, OpenCode, and Antigravity and reports each host as `connected`, `modified`, `missing`, or `error`. Connect and Repair refuse unowned target files; Disconnect removes unchanged generated files and preserves user-modified files.

Codex global integration uses Agent Skills under the current user skill scope rather than legacy custom prompts. Claude Code uses personal skills/subagents, OpenCode uses its global command/agent directories, and Antigravity uses a global plugin directory.

## Runtime

Runtime lists active durable runs and a separate **Crew Processes** table containing only worker subprocesses launched by Agents Crew. Each process row includes host/worker, run/task, PID, state, uptime, and state-aware controls. Pause is cooperative: the current worker operation may finish, then the scheduler remains paused before launching another task. Resume continues durable scheduling; Restart asks the owning worker runner to replace the current attempt; Stop cancels the run and terminates the managed child. Agents Crew does not enumerate unrelated operating-system processes.

Selecting a run still shows status, iterations, tasks, events, durable files, and pending actions. Run-level Pause, Resume, and Cancel use the same validated durable state transitions as CLI commands.

## History

History lists archived durable runs separately from active work. Completed, cancelled, failed, blocked, and other terminal runs remain inspectable with the same detailed task/event/file view, but active-run controls are hidden.

## Section help and controls

Each major section header includes an information button describing the section's controls and use cases. Buttons and text inputs use square corners. The custom combobox supports typing, filtering, keyboard arrows, Enter, Escape, mouse selection, and free-form values where enabled.

## API boundaries

The browser uses authenticated routes under `/api/` only, including `/api/connections` and `/api/processes` for the new control surfaces. Request bodies are limited to 1 MiB. Template IDs, scopes, paths, and configurations are validated before filesystem writes. Static path traversal is rejected. Model catalog requests are made by the loopback server; no provider credentials are requested or sent to the browser.
