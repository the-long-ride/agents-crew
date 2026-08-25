# One-Prompt Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@agents-crew <prompt>` drive a complete Agents Crew run without manual initialization or manager-loop commands while preserving existing low-level APIs as advanced/debug surfaces.

**Architecture:** Add a focused high-level `PromptOrchestrator` that composes the existing config/bootstrap, RunStore, Engine, manager protocol, and AgentMesh. Keep current-workspace execution as the default, persist only minimal orchestration metadata, resume matching active runs by stable request hash, and expose the new path through the CLI and generated host plugin instructions.

**Tech Stack:** TypeScript, Node.js 22+, filesystem persistence, existing dependency-free CLI/runtime, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-25-one-prompt-orchestrator-design.md`

## Global Constraints

- One prompt is the normal product surface.
- `.agents-crew/` is runtime state, not another source workspace.
- Current repository/current branch remains the default execution workspace.
- Do not create worktrees by default.
- Reuse Engine, RunStore, policy, verification, AgentMesh, leases, mailboxes, and A2A.
- Preserve all existing low-level CLI behavior.
- Do not add runtime dependencies.
- Never automatically discard existing user changes during recovery.
- `allow` executes, `ask` surfaces approval, `deny` is never bypassed.
- Run `npm run check` before completion.

---

### Task 1: Prompt orchestration core

**Files:**
- Create: `src/orchestration/prompt-orchestrator.ts`
- Modify: `src/index.ts`
- Test: `test/prompt-orchestrator.test.mjs`

**Interfaces:**
- Consumes: `starterConfig()`, `saveConfig()`, `loadConfig()`, `configPath()`, `buildDefaultRun()`, `store()`, `advanceRun()`, `persistRun()`, `runResponse()`, `RunProtocol`.
- Produces: `normalizePrompt(prompt: string): string`, `requestHash(workspace: string, prompt: string): string`, `ExecutePromptOptions`, `PromptExecutionResult`, `PromptOrchestrator.execute(options)`.

- [ ] **Step 1: Write failing tests for normalization, bootstrap, and resume**

Add tests that:

```js
assert.equal(normalizePrompt('  fix   auth\n reconnect  '), 'fix auth reconnect');
assert.equal(requestHash(root, 'fix   auth'), requestHash(root, ' fix auth '));
```

Create a temporary Git repository/workspace without `.agents-crew`, run `PromptOrchestrator.execute({ workspace, host: 'opencode', prompt: 'inspect auth', mode: 'plan-only' })`, and assert:

```js
assert.equal(existsSync(join(root, '.agents-crew', 'config.toml')), true);
assert.equal((await loadConfig(join(root, '.agents-crew', 'config.toml'))).manager.host, 'opencode');
assert.equal(result.resumed, false);
```

Invoke again with semantically identical whitespace and assert the same `run_id` plus `resumed === true`. Invoke with a different prompt and assert a new `run_id`.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm run build && node --test test/prompt-orchestrator.test.mjs
```

Expected: FAIL because `PromptOrchestrator`, `normalizePrompt`, and `requestHash` are not exported.

- [ ] **Step 3: Implement bootstrap and durable orchestration metadata**

Implement in `src/orchestration/prompt-orchestrator.ts`:

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
```

`normalizePrompt()` trims and collapses all whitespace to one ASCII space. `requestHash()` hashes `resolve(workspace) + '\n' + normalizePrompt(prompt)` using SHA-256.

Add a private bootstrap helper:

```ts
if (!existsSync(configPath(workspace))) {
  const config = starterConfig();
  if (hosts.includes(host as Host)) config.manager.host = normalizeHost(host);
  await saveConfig(configPath(workspace), config);
}
```

Create required `.agents-crew/active`, `history`, and role/runtime directories without overwriting an existing config.

Persist `orchestration.json` under the run directory with:

```ts
{
  request_hash,
  host,
  started_at,
  last_progress_at,
  phase,
  planner_revision: 1
}
```

Scan active runs for matching `request_hash`; resume any non-terminal matching run rather than creating a duplicate.

- [ ] **Step 4: Implement bounded dynamic starter DAG**

Do not use the fixed three-task graph as the only one-prompt behavior. Add a deterministic baseline classifier that keeps the initial implementation dependency-free and safe:

```ts
function classifyPrompt(prompt: string): 'tiny' | 'normal' | 'complex'
```

Rules:

- `tiny`: normalized prompt <= 80 chars and contains no conjunction/list marker (`and`, `then`, comma, semicolon, newline before normalization).
- `complex`: normalized prompt >= 240 chars or contains 3+ explicit action segments split by `and`, `then`, comma, or semicolon.
- otherwise `normal`.

Generate:

```text
tiny:    implement
normal:  inspect -> implement -> verify
complex: research -> implement-a/implement-b when independent segments exist -> verify -> review
```

All writer tasks use current workspace mode and declared scopes. If safe independence cannot be inferred, serialize implement tasks rather than guessing overlapping write scopes.

`plan-only` materializes and returns the run without executing worker tasks. `auto` advances through existing engine behavior until it reaches a native/approval/terminal boundary that must be returned to the invoking host.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build && node --test test/prompt-orchestrator.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Export the new API**

Add:

```ts
export * from './orchestration/prompt-orchestrator.js';
```

to `src/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/orchestration/prompt-orchestrator.ts src/index.ts test/prompt-orchestrator.test.mjs
git commit -m "feat: add one-prompt orchestration core"
```

---

### Task 2: CLI and generated host integration

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/entry.ts`
- Modify: `src/plugins/registry.ts`
- Test: `test/args.test.mjs`
- Test: `test/plugins.test.mjs`
- Test: `test/cli.test.mjs` if present; otherwise extend the closest existing CLI integration test.

**Interfaces:**
- Consumes: `PromptOrchestrator.execute()` from Task 1.
- Produces: `agents-crew orchestrate --goal <prompt> --host <host> [--json]` and generated `@agents-crew` instructions that invoke it.

- [ ] **Step 1: Write failing parser tests**

Add assertions equivalent to:

```js
const parsed = parseArgs(['orchestrate', '--host', 'opencode', 'fix', 'auth', 'reconnect']);
assert.equal(parsed.command, 'orchestrate');
assert.equal(parsed.args.goal, 'fix auth reconnect');
assert.equal(parsed.args.host, 'opencode');
```

Also cover `--goal "..."` overriding positional text.

- [ ] **Step 2: Update parser and CLI usage**

Treat `orchestrate` like `run`/`plan` for positional goals:

```ts
else if (['run', 'plan', 'orchestrate'].includes(command)) {
  args.goal = args.goal ?? positional.join(' ');
}
```

Update CLI usage so `orchestrate` is the first normal command shown, while existing commands remain listed.

- [ ] **Step 3: Dispatch the high-level command**

In `src/cli/commands.ts`:

```ts
if (command === 'orchestrate') {
  return new PromptOrchestrator().execute({
    workspace,
    host: optionalText(args.host) ?? 'opencode',
    prompt: text(args.goal, 'goal'),
    mode: bool(args.plan_only) ? 'plan-only' : 'auto',
  });
}
```

Use the invoking host passed by generated host instructions; the fallback exists only for direct manual CLI calls.

- [ ] **Step 4: Rewrite generated `agents-crew` host command**

Change only the generated primary command content so it tells Codex, Claude Code, OpenCode, and Antigravity to run:

```text
agents-crew orchestrate --host <host> --goal "$ARGUMENTS" --json
```

The instruction must explicitly say:

- do not require `crew init` first;
- do not manually loop `manager start/step/submit` for normal use;
- if the result contains an approval action, present that approval to the user;
- use low-level `crew manager` / `crew agent` commands only for advanced debugging or explicit manual control.

Keep all existing generated low-level command files for compatibility.

- [ ] **Step 5: Run focused CLI/plugin tests**

Run:

```bash
npm run build && node --test test/args.test.mjs test/plugins.test.mjs test/*cli*.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/args.ts src/cli/commands.ts src/cli/entry.ts src/plugins/registry.ts test
git commit -m "feat: expose one-prompt orchestrator"
```

---

### Task 3: Recovery, scheduling safety, and compatibility hardening

**Files:**
- Modify: `src/orchestration/prompt-orchestrator.ts`
- Modify only if needed: `src/orchestration/engine.ts`
- Test: `test/prompt-orchestrator.test.mjs`
- Test: `test/manager.test.mjs`
- Test: `test/agent-mesh.test.mjs`

**Interfaces:**
- Consumes: existing RunStore terminal states, manager recovery functions, AgentMesh lease semantics.
- Produces: safe resumption/reassignment behavior without source reset and writer-overlap scheduling protection.

- [ ] **Step 1: Add failing recovery tests**

Cover:

```text
same request + active working run        -> resume
same request + completed/history run     -> new run
same request + failed/blocked recoverable run -> resume through existing recovery path
```

Assert that recovery never invokes Git reset/checkout or removes uncommitted source files.

- [ ] **Step 2: Add write-scope overlap helper tests**

Export a small pure helper only if useful for testing:

```ts
writeScopesOverlap(left: string[], right: string[]): boolean
```

Required behavior:

```js
assert.equal(writeScopesOverlap(['src/auth'], ['src/ui']), false);
assert.equal(writeScopesOverlap(['src'], ['src/auth']), true);
assert.equal(writeScopesOverlap(['.'], ['src/auth']), true);
```

Use it when constructing/scheduling parallel writer tasks. If scopes are broad or unknown, serialize them.

- [ ] **Step 3: Preserve existing recovery authority**

Reuse `recoverInterruptedTasks`, run statuses, retries, pending actions, and AgentMesh leases. Do not add a second retry counter or second task-state machine.

When a resumed run contains interrupted `running`/`verifying` tasks, invoke the existing recovery mechanism before further planning/execution.

- [ ] **Step 4: Run compatibility tests**

Run:

```bash
npm run build && node --test test/prompt-orchestrator.test.mjs test/manager.test.mjs test/agent-mesh.test.mjs
```

Expected: PASS with old manager and agent-mesh behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/orchestration test
git commit -m "fix: harden orchestrator recovery and scheduling"
```

---

### Task 4: Documentation and final delivery verification

**Files:**
- Modify: `README.md`
- Modify: `docs/manager-protocol.md`
- Modify: `CHANGELOG.md`
- Test: repository delivery/check scripts.

**Interfaces:**
- Consumes: final CLI/host behavior from Tasks 1-3.
- Produces: one-prompt-first documentation with manual manager commands retained under Advanced/Debug.

- [ ] **Step 1: Put one-prompt usage first in README**

Document:

```text
@agents-crew fix OAuth reconnect and add tests
```

and the equivalent CLI form:

```bash
agents-crew orchestrate --host opencode --goal "fix OAuth reconnect and add tests"
```

Explain that `.agents-crew/` is runtime coordination state inside the current repository and is not a second source tree.

- [ ] **Step 2: Move manual manager loop to Advanced/Debug wording**

Keep the protocol intact in `docs/manager-protocol.md`; change framing so `manager start/step/submit` is documented for integrations, debugging, and explicit manual orchestration rather than normal usage.

- [ ] **Step 3: Update changelog**

Add an unreleased entry describing one-prompt orchestration, automatic bootstrap, resume-by-request-hash, dynamic starter DAGs, and preserved manual APIs.

- [ ] **Step 4: Run complete quality gate**

Run:

```bash
npm run check
```

Expected: typecheck, build, lint, file-length checks, delivery verification, all tests, coverage thresholds, and package dry-run all pass.

- [ ] **Step 5: Review final diff**

Confirm:

- no runtime dependency added;
- no low-level command removed;
- no default isolated worktree creation introduced;
- no source-reset recovery behavior added;
- host-generated `agents-crew` uses the high-level orchestrator;
- existing AgentMesh protocol remains intact.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/manager-protocol.md CHANGELOG.md
git commit -m "docs: make one-prompt orchestration the default"
```
