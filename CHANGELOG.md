# Changelog

## Unreleased

- Added a local `README.md` to every maintained repository folder.
- Added `scripts/verify-structure.mjs` and CI enforcement for folder documentation.
- Enforced a hard maximum of 300 physical lines for every Rust source file.
- Split the CLI orchestrator, plugin generator, Git adapter, and core domain model into focused modules.
- Reformatted previously compressed Rust modules so the line limit reflects readable code rather than minification.

## 0.1.0 - 2026-07-27

- Rebuilt Agents Crew as a Rust-first orchestration plugin.
- Added durable task DAGs, scheduler limits, policy approvals, evidence gates, and recovery.
- Added manager-native, local CLI, OpenAI-compatible, and Anthropic worker transports.
- Added current-worktree and isolated-worktree strategies.
- Added generated manager plugins for Codex, Claude Code, OpenCode, and Antigravity.
- Replaced fixed review workflows with a one-prompt managed crew loop.
- Added the universal `crew` binary while retaining `agents-crew` as a compatibility alias.
- Added a TypeScript npm installer that downloads and checksum-verifies GitHub Release binaries.
- Added tagged GitHub Release builds for Linux x64/arm64, macOS x64/arm64, and Windows x64.
- Added generated manager setup during installation and npm publishing with provenance.
