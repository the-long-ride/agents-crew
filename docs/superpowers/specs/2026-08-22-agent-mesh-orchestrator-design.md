# Agent Mesh Orchestrator Design

## Goal

Make Agents Crew a durable coordination/control plane that AI agents can drive directly, while allowing agents to communicate and coordinate with each other without routing every interaction through the engine.

## Architecture

Agents Crew remains authoritative for run state, policy, approvals, recovery, audit, and optional autopilot scheduling. Peer agents are first-class participants registered in a workspace-level agent registry. They coordinate through task leases and durable run mailboxes; when a peer exposes A2A, Agents Crew journals locally first and then attempts direct A2A delivery only when both the sender capability and run permission allow network transport.

The design deliberately avoids a mandatory long-lived daemon. Coding agents can use the JSON CLI or exported TypeScript API from their existing shell/tool environment. A future MCP adapter can expose the same API without changing the coordination model.

## Protocol

### Agent registry

`.agents-crew/agents/<agent-id>.json` stores identity, provider, roles, capabilities, supported interfaces, metadata, registration time, and heartbeat time. A2A interfaces currently require protocol version `1.0` and JSON-RPC. An interface can also carry the optional A2A `tenant` routing value, which must be echoed on every request to that interface. Secrets are never persisted; optional authorization headers reference environment-variable names.

### Task leases

A peer claims a ready/retryable task using an atomic per-task lock. The run must be in `working` state, the registered agent must include the task's required role, and its capabilities must cover every task capability. The claim stores agent id, claim timestamp, expiry, and revision. An unexpired lease prevents another agent from taking the task. Expired leases may be replaced. Release requires the lease owner unless `force` is explicitly requested through a trusted API caller; ordinary peer CLI callers cannot force-release. Claiming updates `task.assigned_worker` and `task.status` to `running`; releasing restores the task to `ready` unless it is already terminal.

### Messages

Messages are durable JSON records under `.agents-crew/<active-or-history>/<run-id>/communication/<recipient>.jsonl`. Each message has an id, sender, recipient, kind, body, optional task/reply references, creation time, and delivery metadata. Runtime callers are validated against the supported message-kind set even when they bypass the CLI type surface.

`send` persists the mailbox record before any network operation. For an agent with an A2A JSON-RPC interface, direct transport requires both the sender's registered `network` capability and the immutable run snapshot's network policy to resolve to `allow`; `ask` or `deny` remains mailbox-only. Eligible delivery uses A2A 1.0 `SendMessage` through native `fetch` with the `A2A-Version: 1.0` header. The JSON-RPC response id must match the request id, and any registered interface tenant is echoed in the request. Direct delivery outcome is stored as a sidecar receipt under `communication/.delivery/`; inbox reads overlay that receipt on the immutable mailbox record. A crash or slow direct transport therefore cannot prevent the durable message from existing locally. On direct failure or when no eligible interface exists, mailbox delivery remains functional.

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

All commands support the existing global `--json` flag. The TypeScript package exports the same coordination API. Force lease release is reserved for trusted TypeScript callers rather than exposed to ordinary peer agents.

## Engine relationship

The existing engine remains useful for DAG progression, policy enforcement, verification, retries, approvals, worktree integration, and autopilot. Peer communication and ownership do not require `advanceRun()` for every interaction, but peer claims cannot progress work while the run lifecycle is paused or otherwise non-working, and direct network delivery cannot bypass the run's snapshotted network permission. Existing manager/run commands continue to work unchanged.

## Host integration

Generated Codex, Claude Code, OpenCode, and Antigravity manager instructions are updated to teach agents to register themselves and use peer messaging/leases when coordinating. No host SDK is required.

## Failure handling

- Invalid agent/run/task ids are rejected before filesystem access.
- Unsupported A2A bindings or protocol versions are rejected at registration.
- Invalid runtime message kinds are rejected at the `AgentMesh` API boundary.
- A2A network errors do not lose messages because the mailbox is persisted before direct delivery.
- Direct A2A requires both agent `network` capability and run `permissions.network = "allow"`.
- JSON-RPC response ids are correlated to the sent message id.
- Duplicate task claims are rejected while a lease is live.
- Expired leases can be reclaimed.
- Task claims require a working run plus matching agent role and capabilities.
- Mailbox reads are non-destructive by default.
- No credentials are written to agent registry files.

## Testing

Tests cover registration persistence, exclusive/reclaimable leases, run/role/capability claim gates, runtime message validation, journal-before-network delivery, A2A 1.0 `SendMessage` and tenant behavior, response correlation, sender/run network gating, mailbox fallback, CLI force-release isolation, CLI parsing/dispatch, and compatibility with existing manager behavior.
