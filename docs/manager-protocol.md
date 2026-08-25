# Manager protocol

Normal host usage should start from the one-prompt orchestrator:

```bash
agents-crew orchestrate --host claude-code --goal "Implement the requested change" --json
```

The generated `@agents-crew` command owns this flow for users: it auto-bootstraps missing runtime state, resumes an equivalent active request, and continues returned native/review actions without asking the user to operate lifecycle commands.

## Advanced and integration protocol

Integrations, diagnostics, and explicit manual orchestration can drive the durable action loop directly:

```bash
crew manager start --goal "..." --host claude-code --json
crew manager step --run <run-id> --json
crew manager submit --run <run-id> --action <action-id> --result <file> --json
```

Before each cycle, read `.agents-crew/active/<run-id>/goal-<run-id>.md`, `status.md`, and the action’s context file. The TypeScript-issued action is authoritative; Markdown files are durable projections, not permission to invent work.

A resumed run loads `crew.snapshot.toml` from its run directory. Completed or cancelled history is inspect-only. Failed runs reopen as manager recovery reviews. Interrupted running/verifying tasks become blocked and receive explicit review actions.

Actions are one-time, expire after 24 hours, and carry a capability envelope. Native results must report every used capability. The runtime rejects mismatches before recording completion. The one-prompt layer composes this protocol but does not weaken or bypass any of these rules.
