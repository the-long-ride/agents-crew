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

## Templates

Templates renders resolved records as a semantic data table with name, ID, scope, worker count, source path, and an Open action. Workspace records override matching global IDs; global records override matching built-ins.

## Runtime

Runtime lists only active durable runs. Selecting a run shows status, iterations, tasks, events, durable files, and pending actions. Pause, resume, and cancel use the same validated state-transition functions as CLI commands.

## History

History lists archived durable runs separately from active work. Completed, cancelled, failed, blocked, and other terminal runs remain inspectable with the same detailed task/event/file view, but active-run controls are hidden.

## Section help and controls

Each major section header includes an information button describing the section's controls and use cases. Buttons and text inputs use square corners. The custom combobox supports typing, filtering, keyboard arrows, Enter, Escape, mouse selection, and free-form values where enabled.

## API boundaries

The browser uses authenticated routes under `/api/` only. Request bodies are limited to 1 MiB. Template IDs, scopes, paths, and configurations are validated before filesystem writes. Static path traversal is rejected. Model catalog requests are made by the loopback server; no provider credentials are requested or sent to the browser.
