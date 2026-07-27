# Security Model

Agents Crew assumes worker models can be mistaken or adversarially influenced by repository content. Rust checks enforce declared capabilities, approvals, repository changes, and normalized results. Host or operating-system sandboxing remains the outer boundary for worker processes.

- Balanced policy allows local reads, scoped edits, and configured tests.
- Declared network, destructive, credentialed, commit, push, and deploy operations require approval in balanced mode; API transports automatically request network and credential approval.
- API keys are resolved from environment variables and redacted from errors.
- CLI workers run without a shell and receive a minimal environment.
- CLI workers default to guarded network and credential use; only explicitly configured offline/local transports may disable those prerequisites.
- API workers are read-only.
- Git snapshots separate pre-existing changes from worker changes.
- Write scope is validated after every write task.
- Git-relative changes must remain inside explicit write scopes; parent-directory scoped paths are rejected.
- Generated plugin files contain no credentials and are hash-owned.
- Interrupted workers are not silently rerun. Recovery creates a manager review boundary before further writes.

Use host-level permissions as a second boundary; do not disable the Rust policy checks.
