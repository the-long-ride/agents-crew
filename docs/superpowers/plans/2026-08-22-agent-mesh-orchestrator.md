# Agent Mesh Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable peer-agent registration, leases, messaging, A2A-first delivery, and a JSON CLI/API so AI agents can orchestrate Agents Crew without making the engine a mandatory message relay.

**Architecture:** Add a focused `AgentMesh` coordination service backed by the existing `.agents-crew` run storage. It owns agent registry, task leases, and mailboxes; A2A is an optional transport adapter with durable mailbox fallback. Existing engine/manager logic stays authoritative for run lifecycle and policy.

**Tech Stack:** TypeScript, Node.js 22+, filesystem persistence, native `fetch`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-22-agent-mesh-orchestrator-design.md`

## Global Constraints

- No new runtime dependencies.
- A2A protocol target is 1.0 JSON-RPC for direct peer delivery.
- Mailbox persistence remains available when direct delivery is absent or fails.
- Existing CLI and manager behavior must remain compatible.
- All agent-facing CLI operations must support `--json`.

---

### Task 1: Durable agent mesh core

**Files:**
- Create: `src/orchestration/agent-mesh.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/index.ts`
- Test: `test/agent-mesh.test.mjs`

**Interfaces:**
- Produces: `AgentMesh`, `AgentRegistration`, `TaskLease`, `AgentMessage`.

- [ ] Step 1: Add failing tests for registration, listing, exclusive task claim, lease expiry/reclaim, release, and mailbox inbox.
- [ ] Step 2: Run the agent-mesh test and verify failure because `AgentMesh` is not exported.
- [ ] Step 3: Implement minimal filesystem-backed registry, leases, and mailboxes with atomic lock directories.
- [ ] Step 4: Run the focused tests and verify pass.

### Task 2: A2A-first direct messaging with fallback

**Files:**
- Create: `src/orchestration/a2a.ts`
- Modify: `src/orchestration/agent-mesh.ts`
- Test: `test/agent-mesh.test.mjs`

**Interfaces:**
- Produces: `sendA2AMessage(endpoint, message)` used by `AgentMesh.sendMessage`.

- [ ] Step 1: Add a failing local HTTP-server test expecting A2A 1.0 JSON-RPC `message/send`, `A2A-Version: 1.0`, and local journaling.
- [ ] Step 2: Run the focused test and verify failure because direct delivery is missing.
- [ ] Step 3: Implement native-fetch A2A transport; resolve auth header values only from named environment variables.
- [ ] Step 4: Verify direct success and network-failure mailbox fallback.

### Task 3: Agent-facing CLI and host instructions

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/entry.ts`
- Modify: `src/plugins/registry.ts`
- Test: `test/args.test.mjs`
- Test: `test/commands.test.mjs`
- Test: `test/plugins.test.mjs`

**Interfaces:**
- Produces: `crew agent register|list|heartbeat|claim|release|send|inbox|capabilities`.

- [ ] Step 1: Add failing parser/dispatch/plugin tests for the new agent command family.
- [ ] Step 2: Verify tests fail on the missing command family.
- [ ] Step 3: Implement command parsing and dispatch as thin wrappers over `AgentMesh`.
- [ ] Step 4: Update generated host instructions to register/use peer coordination rather than requiring every cycle through the engine.
- [ ] Step 5: Run focused tests, then the full `npm test`/CI suite.

### Task 4: Final verification

- [ ] Run typecheck, lint, unit tests, coverage/delivery checks through repository CI.
- [ ] Review the branch diff for scope and accidental unrelated changes.
- [ ] Confirm existing manager/run commands remain untouched except for additive integration.
