# Troubleshooting

## Diagnose first

```bash
crew doctor --json
crew config validate --json
crew status --json
```

## Worker unavailable

Verify executable name, `--version` behavior, model support, environment allowlist, and adapter argument overrides.

## API worker unavailable

Confirm the configured environment variable exists. Doctor reports only presence, never its value.

## Write-scope failure

Narrow worker instructions or expand the task's explicit write scope. Do not disable scope checking globally.

## Interrupted run

Run state is under `.agents-crew/runs/<id>/`. Remove only orphaned `.tmp` files; do not delete `run.json` or `events.jsonl`. Use `crew resume --run <id>`.

## Isolated integration conflict

Failed worktrees are retained. Inspect the exported patch and assign a dedicated integrator or resolution task.


## Expired manager action

`status --json` lists expired actions. Inspect the referenced current workspace or retained task worktree for partial changes before cancelling the run or starting a replacement run. Expired actions cannot be replayed.


## Interrupted task requires review

Agents Crew persists `running` state before launching a worker. After a crash or forced termination, `resume` changes interrupted tasks to `blocked` and issues a manager `review` action. Inspect current-branch changes or the retained isolated worktree, then cancel/replace the task through the returned manager decision. The core does not silently repeat a possibly side-effecting worker invocation.
