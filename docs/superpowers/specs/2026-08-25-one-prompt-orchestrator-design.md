# One-Prompt Orchestrator Design

## Goal

Make `@agents-crew <prompt>` the default way to use Agents Crew. A user or parent AI agent should provide one request and let Agents Crew detect the current repository, bootstrap missing runtime state, create the smallest useful task graph, select capable agents, coordinate them, recover from interruptions, verify the result, and return completion without requiring manual `init`, `manager start`, `manager step`, `manager submit`, crew naming, or per-agent control commands.

Existing low-level commands remain available as advanced/debug APIs for compatibility and diagnostics.

## Design principles

- One prompt is the normal product surface.
- `.agents-crew/` is implementation state, not a second source workspace.
- The current repository and current branch are the default execution workspace.
- Do not create source copies or worktrees by default. Existing isolated-worktree support remains explicit/advanced behavior.
- Reuse the existing Engine, RunStore, policy, verification, AgentMesh, leases, mailboxes, and A2A transport.
- The orchestrator owns high-level intent, task planning, scheduling, recovery, and completion supervision; it does not become a mandatory relay for routine agent-to-agent messages.
- Prefer the smallest useful crew. Do not spawn agents merely because predefined roles exist.
- Capability and task constraints are authoritative; roles are matching hints and policy labels.
- Preserve existing CLI compatibility in this change.
- Add no runtime dependency.

## Architecture

Add a new high-level `PromptOrchestrator` above the existing orchestration components.

```text
@agents-crew "<prompt>"
        |
        v
+----------------------+
| PromptOrchestrator   |
| - detect workspace   |
| - auto-bootstrap     |
| - normalize request  |
| - create task DAG    |
| - select agents      |
| - supervise/recover  |
| - verify completion  |
+----------+-----------+
           |
     +-----+-----+
     v           v
   Engine     AgentMesh
 lifecycle   peer coordination
 policy      leases/messages/A2A
 verify
     |           |
     +-----+-----+
           v
 Codex / Claude Code / OpenCode / Antigravity
           |
           v
      current source repository
```

The Engine remains authoritative for run lifecycle, guarded operations, approvals, retries, verification, and completion. AgentMesh remains responsible for peer registration, task leases, durable mailboxes, and optional direct A2A delivery.

The new orchestrator composes those services into a single invocation.

## Public API

Primary TypeScript API:

```ts
export interface ExecutePromptOptions {
  workspace: string;
  host: string;
  prompt: string;
  mode?: 'auto' | 'plan-only';
}

export interface PromptExecutionResult {
  run_id: string;
  status: string;
  resumed: boolean;
  summary?: string;
  actions?: unknown[];
}

export class PromptOrchestrator {
  execute(options: ExecutePromptOptions): Promise<PromptExecutionResult>;
}
```

The exact result shape may reuse existing run-response types where practical, but callers must be able to identify the run, current status, whether an existing run was resumed, and any user-facing action such as approval.

## User-facing command model

The generated host command named `agents-crew` becomes the normal entry point and instructs the host AI to execute a single high-level orchestration command/API rather than manually driving manager actions.

Normal UX:

```text
@agents-crew fix OAuth reconnect and add tests
```

The CLI should expose one direct high-level command suitable for host prompts, for example:

```text
agents-crew orchestrate --goal "fix OAuth reconnect and add tests" --host opencode --json
```

Low-level commands remain supported:

```text
crew manager ...
crew agent ...
crew status ...
crew config ...
```

Documentation moves these low-level flows under Advanced/Debug usage rather than removing them.

## Auto-bootstrap

Normal orchestration must not fail merely because `.agents-crew/config.toml` does not exist.

When configuration is missing, the orchestrator creates the minimum runtime structure and starter configuration required to execute the prompt. Bootstrap must:

- use the current workspace;
- set the invoking host as manager host when known;
- preserve starter permission defaults;
- not overwrite an existing configuration;
- not require plugin installation before the orchestration call can proceed;
- keep generated/runtime files under `.agents-crew/`.

Existing explicit `crew init` remains available for advanced users.

## Request normalization and duplicate-run recovery

Each invocation derives a stable request hash from the normalized prompt and workspace identity. Normalization should remove meaningless surrounding whitespace and normalize repeated whitespace without changing semantic content.

If an active, recoverable run exists for the same workspace and request hash, orchestration resumes it rather than creating a duplicate run. A materially different prompt creates a new run.

A small per-run orchestration metadata file may be added:

```text
.agents-crew/active/<run-id>/orchestration.json
```

It stores only durable control metadata such as:

```ts
interface OrchestrationMetadata {
  request_hash: string;
  host: string;
  started_at: string;
  last_progress_at: string;
  phase: 'planning' | 'executing' | 'verifying' | 'blocked' | 'completed';
  planner_revision: number;
}
```

Do not persist model chain-of-thought or duplicate large prompt/context blobs in this file.

## Dynamic task planning

The existing fixed `research -> implement -> review` starter graph is not the normal one-prompt planner.

The planner generates the smallest useful DAG for the request.

Examples:

```text
tiny request
└─ implement

normal bug fix
├─ inspect
├─ implement
└─ verify

complex feature
├─ research
├─ architecture
├─ backend
├─ frontend
├─ tests
└─ review
```

Task creation must respect existing task limits, capabilities, policy, verification, and dependency validation.

The planner may use the invoking host AI through the existing manager/native action protocol, but the user must not have to manually submit each manager action. The orchestrator owns that lifecycle.

## Task requirements and agent matching

Introduce or derive a task requirement model equivalent to:

```ts
interface TaskRequirement {
  role?: Role;
  capabilities: Capability[];
  write_scope: string[];
  needs_independent_review?: boolean;
}
```

Selection order:

1. an already-active registered peer that satisfies requirements;
2. a preferred configured worker;
3. the highest-priority eligible local/native worker;
4. another eligible CLI/API worker;
5. fail only when no capable worker can execute the task.

Roles remain useful but capability coverage, workspace constraints, task state, and write scope are authoritative.

## Concurrency and source safety

Default execution occurs in the current repository.

- Multiple read-only tasks may run concurrently within configured limits.
- Writers may run concurrently only when their declared write scopes do not overlap.
- Overlapping writers are serialized.
- Existing user changes are never automatically reset, discarded, or overwritten as part of recovery.
- `.agents-crew/` changes are ignored when determining source modifications.
- Isolated worktree mode remains available when explicitly configured, but is not the default path created by one-prompt orchestration.

## Peer communication

Routine peer communication stays on AgentMesh:

```text
Agent A <-> AgentMesh <-> Agent B
```

The orchestrator does not relay ordinary messages. It observes only the state needed to supervise execution: claims, blockers, review findings, completion, and failed/stale ownership.

Agents may request help or send task context to peers through the durable mailbox/A2A mechanism. Existing network policy still controls direct delivery.

## Failure and recovery

The orchestrator is restart-safe without requiring a permanent daemon.

### Stale or failed agent

```text
stale lease / dead worker
        |
        v
preserve source + run + mailbox
        |
        v
inspect task-owned changes
        |
        +-- clearly valid partial work --> preserve and reassign/continue
        |
        +-- uncertain ------------------> create review/recovery task
```

No recovery path may automatically wipe uncommitted source changes.

### Retry policy

- Retry a transient worker failure on the same worker when appropriate and attempts remain.
- Reassign to another eligible worker when the original worker is unavailable or repeatedly fails.
- Preserve prior evidence and messages for the replacement worker.
- A rejected review returns findings to an implementation/recovery task and reruns only affected verification where practical.
- Configuration/runtime corruption stops orchestration before additional source mutation.

### Existing interrupted states

Reuse existing manager recovery and run state mechanisms rather than introducing a second lifecycle system.

## Approval behavior

Approval remains policy-driven.

- `allow`: execute automatically.
- `ask`: surface one concise approval request and pause only the guarded operation that requires it.
- `deny`: do not bypass; fail or replan around the denied capability when possible.

The orchestrator must never manufacture approval IDs or bypass the existing policy engine.

## Completion behavior

The orchestrator continues until one of these states is reached:

- completed and verified;
- awaiting a real user approval;
- blocked by missing capability/credential/runtime that cannot be resolved safely;
- failed after configured retry limits;
- cancelled/paused explicitly.

A final result should summarize completed work, verification evidence, and any remaining blocker without exposing internal command ceremony.

## Compatibility

This change is additive.

- Existing `crew manager ...` behavior remains functional.
- Existing `crew agent ...` behavior remains functional.
- Existing manager action IDs, policy enforcement, verification, and run storage semantics remain authoritative.
- Existing host plugin generation remains supported, but generated `agents-crew` instructions are changed to prefer the high-level orchestrator.
- Manual manager-loop documentation moves to Advanced/Debug rather than being deleted.

Do not deprecate or remove low-level APIs in this implementation.

## Testing

### Unit tests

Cover:

- prompt normalization and request hash stability;
- auto-bootstrap without overwriting an existing config;
- host-aware starter config;
- dynamic DAG sizing for tiny, normal, and complex prompts;
- agent/worker capability matching;
- overlapping write-scope serialization decisions;
- orchestration metadata validation;
- recovery decision behavior.

### Integration tests

Cover:

- missing `.agents-crew` state -> one prompt still starts;
- same normalized prompt -> recoverable active run resumes;
- different prompt -> new run;
- current workspace mode -> no task worktree is created by default;
- AgentMesh peer messaging/leases continue to work;
- failed/stale worker can be reassigned while preserving run context;
- `ask` policy surfaces approval instead of bypassing it;
- successful run reaches verified completion through the high-level orchestration surface.

### Compatibility tests

Keep coverage for:

- `crew manager ...`;
- `crew agent ...`;
- `crew status ...`;
- plugin generation for Codex, Claude Code, OpenCode, and Antigravity;
- existing manager/run storage behavior.

Run the repository's full `npm run check` gate before completion.

## Migration

### Phase 1 — this change

Add the high-level orchestrator, auto-bootstrap, dynamic planning/scheduling, recovery metadata, and host integration. Keep all existing low-level APIs.

### Phase 2 — documentation/UX emphasis

Make one-prompt orchestration the first README workflow. Move manual manager-loop examples to Advanced/Debug documentation.

### Phase 3 — later, evidence-based cleanup

Only after real-world usage demonstrates that wrappers are redundant should low-level surface cleanup be considered. It is explicitly out of scope for this design.

## Non-goals

- Removing the Engine.
- Replacing AgentMesh.
- Requiring provider SDKs.
- Adding a mandatory daemon.
- Creating a second persistence database.
- Persisting hidden model reasoning.
- Automatically discarding user source changes.
- Removing advanced/manual CLI commands.
