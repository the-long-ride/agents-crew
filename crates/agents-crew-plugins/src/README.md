# Manager Host Integrations Source

## Mission

Generates commands, agents, skills, rules, and ownership manifests for Codex, Claude Code, OpenCode, and Antigravity.

## Files

| Path | Responsibility |
| --- | --- |
| `lib.rs` | Public host/plugin types and shared constants. |
| `install.rs` | Plan, install, doctor, and uninstall operations. |
| `layout.rs` | Host-specific generated file paths. |
| `content.rs` | Generated command, manager, and role content. |
| `manifest.rs` | Ownership manifest loading and SHA-256 helpers. |
| `tests.rs` | Cross-host generation tests. |

## Editing rules

- Keep every `.rs` file at or below 300 physical lines.
- Split new responsibilities into focused modules.
- Keep public API changes deliberate and covered by tests.
