# Security

Agents Crew assumes worker models can be mistaken or influenced by repository content. TypeScript runtime checks enforce declared capabilities, approvals, write scope, normalized results, task dependencies, action one-time use, and completion evidence. Host and operating-system sandboxing remain the outer boundary for worker processes.

Key protections:

- CLI processes are spawned with argument arrays, not interpolated shell strings.
- Only a minimal environment plus configured allowlisted variables reaches CLI workers.
- Doctor reports credential presence only; values are never printed.
- API workers cannot receive write tasks or claim changed files.
- Changed paths are canonicalized and checked against task write scopes.
- Current-workspace mode serializes writers; isolated mode uses Git worktrees.
- Destructive, credentialed, network, commit, push, and deploy operations follow `allow`/`ask`/`deny` policy.
- Browser UI binds to `127.0.0.1`, requires a random per-launch API token, caps request bodies at 1 MiB, and blocks static path traversal.
- Native write results are checked against actual Git changes rather than worker-reported file lists.
- Persisted run/action JSON and manager decisions are runtime-validated before use.
- State/action and Git integration locks are PID-owned and recoverable after a crashed process.
- Plugin manifests are runtime-validated and limited to exact host-generated paths before doctor, overwrite, or uninstall operations.
- Worker subprocesses keep only a minimal cross-platform baseline environment plus explicit allowlisted secrets.

Do not disable runtime checks merely because a host prompt contains similar instructions.
