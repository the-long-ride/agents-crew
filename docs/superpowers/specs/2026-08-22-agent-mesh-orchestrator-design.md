# Agent Mesh Orchestrator Design

## Goal

Make Agents Crew a durable coordination/control plane that AI agents can drive directly, while allowing agents to communicate and coordinate with each other without routing every interaction through the engine.

## Architecture

Agents Crew remains authoritative for run state, policy, approvals, recovery, audit, and optional autopilot scheduling. Peer agents are first-class participants registered in a workspace-level agent registry. They coordinate through task leases and durable run mailboxes; when a peer exposes A2A, Agents Crew attempts direct A2A delivery first and records/falls back to the mailbox when direct delivery is unavailable.

The design deliberately avoids a mandatory long-lived daemon. Coding agents can use the JSON CLI or exported TypeScript API from their existing shell/tool environment. A future MCP adapter can expose the same API without changing the coordination model.

## Protocol

### Agent registry

`.agents-crew/agents/<agent-id>.json` stores identity, provider, roles, capabilities, supported interfaces, metadata, registration time, and heartbeat time. A2A interfaces use protocol version `1.0` and JSON-RPC unless another supported binding is explicitly added later. Secrets are never persisted; optional authorization headers reference environment-variable names.

### Task leases

A peer claims a ready/retryable task using an atomic per-task lock. The claim stores agent id, claim timestamp, expiry, and revision. An unexpired lease prevents another agent from taking the task. Expired leases may be replaced. Release requires the lease owner unless `force` is explicitly requested by a trusted caller. Claiming updates `task.assigned_worker` and `task.status` to `running`; releasing restores the task to `ready` unless it is already terminal.

### Messages

Messages are durable JSON records under `.agents-crew/<active-or-history>/<run-id>/communication/<recipient>.jsonl`. Each message has an id, sender, recipient, kind, body, optional task/reply references, creation time, and delivery metadata.

For an agent with an A2A JSON-RPC interface, `send` attempts an A2A 1.0 `message/send` request first using native `fetch` and the `A2A-Version: 1.0` header. Regardless of direct success, the message is journaled locally for audit. On direct failure or when no interface exists, mailbox delivery is the functional fallback.

### Agent-facing control surface

`crew agent` exposes machine-safe subcommands:

- `register`
- `list`
- `heartbeat`
- `claim`
- `release`
- `send`
- `inbox`
- `capabilities`

All commands support the existing global `--json` flag. The TypeScript package exports the same coordination API.

## Engine relationship

The existing engine remains useful for DAG progression, policy enforcement, verification, retries, approvals, worktree integration, and autopilot. Peer communication and ownership do not require `advanceRun()` for every interaction. Existing manager/run commands continue to work unchanged.

## Host integration

Generated Codex, Claude Code, OpenCode, and Antigravity manager instructions are updated to teach agents to register themselves and use peer messaging/leases when coordinating. No host SDK is required.

## Failure handling

- Invalid agent/run/task ids are rejected before filesystem access.
- A2A network errors do not lose messages; the mailbox remains authoritative for durable delivery/audit.
- Duplicate task claims are rejected while a lease is live.
- Expired leases can be reclaimed.
- Mailbox reads are non-destructive by default.
- No credentials are written to agent registry files.

## Testing

Tests cover registration persistence, exclusive/reclaimable leases, mailbox delivery, A2A direct-send plus local journaling, CLI parsing/dispatch, and compatibility with existing manager behavior.
