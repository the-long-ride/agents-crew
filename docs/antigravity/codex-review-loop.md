# Antigravity Codex Review Loop

This repository owns the portable review-loop implementation used by Antigravity workspaces.

Workspace responsibilities stay local:

- `.agents/hooks.json`
- `.agents/rules/codex-review-loop.md`
- local wrapper script that delegates into `agents-crew`

Core responsibilities live here:

- task preparation
- diff sealing
- review execution
- hook decision logic
- schema validation
- review-cycle limits

Task JSON fields:

- `taskId`
- `goal`
- `acceptanceCriteria`
- `tests`
- `implementationSummary`
- `conversationId`

