# Manager protocol

The host manager drives a durable action loop rather than bypassing the runtime.

```bash
crew manager start --goal "..." --host claude-code --json
crew manager step --run <run-id> --json
crew manager submit --run <run-id> --action <action-id> --result <file> --json
```

Before each cycle, read `.agents-crew/active/<run-id>/goal-<run-id>.md`, `status.md`, and the action’s context file. The TypeScript-issued action is authoritative; Markdown files are durable projections, not permission to invent work.

A resumed run loads `crew.snapshot.toml` from its run directory. Completed or cancelled history is inspect-only. Failed runs reopen as manager recovery reviews. Interrupted running/verifying tasks become blocked and receive explicit review actions.

Actions are one-time, expire after 24 hours, and carry a capability envelope. Native results must report every used capability. The runtime rejects mismatches before recording completion.
