# Changelog

## 0.3.0

- Added grab-to-pan, pointer-centered wheel zoom, Fit, and Reset controls to the Builder graph without canvas scrollbars.
- Added a keyless Models.dev catalog with six-hour workspace caching, stale fallback, manual model IDs, and host-aware suggestions for Codex, Claude Code, and Antigravity.
- Replaced native selects with one searchable custom combobox component and converted Templates to a semantic data table.
- Added explicit dark and light theme controls, square form controls, and reusable section information popovers.
- Split active Runtime and archived History into separate tabs with filtered durable-run APIs.
- Archived completed, cancelled, failed, and blocked runs consistently, including empty-schedule terminal transitions.
- Added graph-math, model-catalog, component, delivery, API, and history regression tests.

## 0.2.0

- Reorganized the TypeScript runtime into focused `cli`, `config`, `domain`, `orchestration`, `runtime`, `templates`, `plugins`, `shared`, and `ui` source areas.
- Restored the local control plane with Builder, Templates, and Runtime tabs.
- Added draggable crew nodes and inspectors for manager/worker adapters, models, roles, capabilities, network access, and credential requirements.
- Added authenticated template bootstrap and CRUD routes for global and workspace templates.
- Expanded Runtime with task progress, events, durable files, pending actions, and shared run controls.
- Kept the browser bundle framework-free and the package dependency-free.
- Added structure, static-delivery, browser-model, API, and UI integration tests.

## 0.1.1

- Enforced write scope from actual Git deltas, including modified and untracked files, instead of worker claims.
- Serialized isolated-worktree integration and added recoverable PID-owned Git/state/action locks.
- Preserved one-time native actions after rejected submissions and persisted all approval/terminal transitions.
- Added runtime validation for manager plans, task drafts, worker results, stored runs/actions, API endpoints, and identifiers.
- Blocked plugin-manifest path escape during doctor and uninstall.
- Unified CLI/UI run controls and protected the loopback API with a per-launch token and request-size limit.
- Preserved platform environment required by Node command shims and contained missing browser-launcher errors.
- Corrected task-draft schemas, reproducible builds, honest all-runtime coverage, and fail-closed type checking.
- Published the exact verified tarball and ensured npm CLI 11.5.1+ for trusted publishing.

## 0.1.0

- Migrated the orchestration runtime from a multi-crate Rust workspace to one dependency-free TypeScript npm package.
- Replaced native platform binaries and the downloader installer with direct npm installation.
- Preserved `crew` and `agents-crew` command aliases, durable `.agents-crew` state, manager actions, plugins, worker routing, approvals, Git worktrees, templates, and local UI.
- Added a focused built-in TOML reader/writer and Node-native TypeScript build.
- Replaced Rust/platform GitHub Actions with npm checks, npm tarball artifacts, GitHub Releases, and npm publishing.
- Simplified local development to `npm run build && npm link`.
