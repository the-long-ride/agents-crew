# Plugins

`agents-crew` can generate workspace-local plugin files for Codex, Antigravity, Claude Code, OpenCode, and GitHub Copilot. The generated files do not replace the core CLI; they give each host native commands or hook instructions that delegate back to `agents-crew` and the shared `.agents-crew/` state directory.

## Setup

List supported hosts:

```bash
agents-crew plugin list --json
```

Preview generated files:

```bash
agents-crew plugin install all --workspace . --dry-run --json
```

Install one host:

```bash
agents-crew plugin install antigravity --workspace . --json
```

Check installation health:

```bash
agents-crew plugin doctor all --workspace . --json
```

Remove generated files:

```bash
agents-crew plugin uninstall opencode --workspace . --json
```

## Generated Files

| Host | Default path | Hook integration |
|---|---|---|
| `antigravity` | `.agents/hooks/` | Writes `.agents/hooks.json` with `model_stop -> agents-crew hook --adapter antigravity --json`. |
| `codex` | `.codex/agents-crew/` | Writes `.codex/hooks.json` using Codex `Stop` command hooks from trusted project config layers. |
| `claude-code` | `.claude/commands/agents-crew/` | Writes `.claude/plugins/agents-crew/` with `.claude-plugin/plugin.json` and `hooks/hooks.json` using Claude Code `Stop` hooks. |
| `opencode` | `.opencode/agents-crew/` | Writes `.opencode/plugins/agents-crew.js`, loaded from OpenCode project plugins, listening for `session.idle`. |
| `github-copilot` | `.vscode/agents-crew-copilot/` | Writes `.github/hooks/agents-crew.json` with Copilot CLI `agentStop` hooks for bash and PowerShell. |

Every host gets:

- `manifest.json` with command and hook metadata.
- `COMMANDS.md` for human-readable command setup.
- A host-native hook/plugin file when the host documents a local hook mechanism.

## Hook Sources Used

- Codex: project `.codex/hooks.json` / inline hooks use lifecycle events such as `Stop`; project hooks load only for trusted projects.
- Claude Code: plugins can include `hooks/hooks.json`; `Stop` fires after Claude finishes a turn and command hooks receive JSON on stdin.
- OpenCode: local plugins load from `.opencode/plugins/`; plugins can subscribe to events such as `session.idle`.
- GitHub Copilot CLI: repository hooks live under `.github/hooks/*.json`, use `version: 1`, and support events such as `agentStop` with `bash` and `powershell` commands.
- Antigravity: existing repo adapter uses the documented Antigravity-style `model_stop` stdin payload and `agents-crew hook --adapter antigravity --json` entrypoint.

## Safety Model

- Generated files contain no secrets, tokens, or credentials.
- Existing files are skipped unless `--force` is provided.
- `uninstall` removes only files containing the generated marker.
- Runtime task data remains in `.agents-crew/`; plugin files are only host entry points.
- The existing diff guard, workspace lock, and `DISABLED` sentinel still control automation.

## Failure Handling

| Failure | Behavior |
|---|---|
| Unknown host | Command exits non-zero with an error. |
| Existing file during install | File is skipped unless `--force` is used. |
| Missing generated file during uninstall | Reported as `missing`; no error. |
| User-managed file during uninstall | File is skipped if the generated marker is absent. |
| Missing `.agents-crew/` state | `doctor` warns and suggests `agents-crew init` or `setup`. |

## Example

```bash
agents-crew setup --workspace . --workflow implement-review \
  --implementer claude-code --reviewer codex \
  --task-id plugin-001 --goal "Review plugin install flow" \
  --prepare --json

agents-crew plugin install all --workspace . --json
agents-crew plugin doctor all --workspace . --json
```
