# Changelog

## 0.0.2

- Added double-click inline rename for crew and group items in the Crew library sidebar (Enter/blur to save, Escape to cancel).
- Redesigned canvas toolbar as a 2×2 grid: eyebrow + info button on top row, metadata inputs + action buttons on bottom row.
- Moved graph zoom controls (Fit, Reset zoom) from header to absolute overlay on canvas top-right.
- Fixed missing `#canvas-title` element preventing Builder view from mounting.
- Fixed missing `#crews-view` element after renaming the Templates tab to Crews, aligning `ViewName` with the HTML nav and view sections.
- Fixed double-click inline rename losing focus mid-typing by replacing `.list-row-select` from `<button>` to `<div role="button">`, decoupling the group toggle button from the title span, adding `stopPropagation` on all inline `<input>` events, clearing pending collapse timers on double-click, and deferring `input.focus()` via `setTimeout` to outlast pending mouseup events.
- Added `dragstart` guard to prevent drag-and-drop from firing when a row contains an active inline rename input.
- Added text-overflow ellipsis truncation for long crew names (`.list-row-name`) and group header titles (`.group-header-title > span`), with `flex-shrink: 0` on action buttons so counts and icons remain fully visible.
- Increased left sidebar min-width from 200 px to 260 px (CSS `minmax`, CSS custom property, `resizeSidebarWidth` clamp, ARIA `aria-valuemin`, and resizer unit test) to eliminate the horizontal scrollbar.
- Made the Global / Workspace scope switch a dual-purpose control: clicking a tab now filters the Crew library to show only crews from that scope (plus always-visible builtin crews) in addition to setting the save destination for new crews. Empty states report the active scope ("No global crews", "No workspace crews matching your search").
- Updated scope switch tooltips to "Show global crews · new crews save globally" and "Show workspace crews · new crews save to this repo".
- Added `ui/test/crew-list.test.mjs` with 20 tests covering UI components and crew list features.
- Configured GitHub Actions release workflow for npm Trusted Publishers (OIDC keyless publishing).
- Added green and red borderline colors for WebUI toast notifications based on success or error status.
- Added structured human CLI presentation with TTY-aware ANSI colors, status symbols, hierarchy/indentation, and unchanged color-free `--json` output.
- Added a Connect tab for safe global user-scope wiring of Codex, Claude Code, OpenCode, and Antigravity, with ownership-aware check/connect/repair/disconnect operations.
- Migrated global Codex wiring to Agent Skills rather than removed custom prompts.
- Added a durable managed-process registry and Runtime process table for Agents-Crew-owned workers, including safe Pause/Resume scheduling plus Restart/Stop controls.
- Made the scheduler observe externally persisted pause/cancel state between task boundaries so a safe pause never launches the next task.

## 0.0.1

- Migrated the orchestration runtime from a multi-crate Rust workspace to one dependency-free TypeScript npm package.
- Replaced native platform binaries and the downloader installer with direct npm installation.
- Preserved `crew` and `agents-crew` command aliases, durable `.agents-crew` state, manager actions, plugins, worker routing, approvals, Git worktrees, templates, and local UI.
- Added a focused built-in TOML reader/writer and Node-native TypeScript build.
- Replaced Rust/platform GitHub Actions with npm checks, npm tarball artifacts, GitHub Releases, and npm publishing.
- Reorganized the TypeScript runtime into focused `cli`, `config`, `domain`, `orchestration`, `runtime`, `templates`, `plugins`, `shared`, and `ui` source areas.
- Added draggable crew nodes and inspectors for manager/worker adapters, models, roles, capabilities, network access, and credential requirements.
- Added authenticated template bootstrap and CRUD routes for global and workspace templates.
- Expanded Runtime with task progress, events, durable files, pending actions, and shared run controls.
- Added grab-to-pan, pointer-centered wheel zoom, Fit, and Reset controls to the Builder graph without canvas scrollbars.
- Added a keyless Models.dev catalog with six-hour workspace caching, stale fallback, manual model IDs, and host-aware suggestions for Codex, Claude Code, and Antigravity.
- Replaced native selects with one searchable custom combobox component and converted Templates to a semantic data table.
- Added explicit dark and light theme controls, square form controls, and reusable section information popovers.
- Split active Runtime and archived History into separate tabs with filtered durable-run APIs.
- Archived completed, cancelled, failed, and blocked runs consistently, including empty-schedule terminal transitions.
- Enforced write scope from actual Git deltas, including modified and untracked files, instead of worker claims.
- Serialized isolated-worktree integration and added recoverable PID-owned Git/state/action locks.
- Preserved one-time native actions after rejected submissions and persisted all approval/terminal transitions.
- Added runtime validation for manager plans, task drafts, worker results, stored runs/actions, API endpoints, and identifiers.
- Blocked plugin-manifest path escape during doctor and uninstall.
- Unified CLI/UI run controls and protected the loopback API with a per-launch token and request-size limit.
- Preserved platform environment required by Node command shims and contained missing browser-launcher errors.
- Renamed UI terminology: Template→Crew, Manager→Boss, Worker→Member across all TypeScript types, variables, functions, HTML IDs, CSS classes, labels, and test files.
- Updated delivery test assertions to match renamed terminology.
- Added Engram project memory workspace for all rules, knowledge, workflows, and skills from AGENTS_CREW_AGENT_MEMORY.md.
