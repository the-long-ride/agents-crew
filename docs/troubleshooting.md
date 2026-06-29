# Troubleshooting

## Command not found

Run:

```bash
npm run build
npm link
npm prefix --global
```

Ensure the global npm bin directory is on `PATH`.

## Node version error

Use Node.js 22.13 or newer:

```bash
node --version
```

## Config invalid

```bash
crew config validate --json
crew config show --json
```

Check duplicate worker IDs, missing roles, invalid capabilities, writable API workers, and required API fields.

## No eligible worker

```bash
crew worker probe --json
crew doctor --json
```

Confirm the worker is enabled, supports the task role/capabilities, and its command or credential environment variable is available.

## Run stuck after interruption

```bash
crew resume <run-id> --json
```

Running/verifying tasks are converted to blocked tasks with durable manager review actions. Inspect the reported worktree before submitting a recovery decision.

## UI does not open

```bash
crew ui --no-open
```

Open the printed `http://127.0.0.1:<port>` address manually.
