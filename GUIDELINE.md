# Development Guidelines

Reference for contributors working on `agents-crew`.

## Prerequisites

- Node.js >= 20 (CI matrix: 20, 22, 24)
- npm
- `git` on PATH (the prepare/hook commands invoke git for diff snapshots)

## Common scripts

```bash
npm run build          # compile TypeScript (tsc -p tsconfig.json) → dist/
npm test               # build + run all tests (node --test tests/*.test.mjs)
npm run lint           # line-count check (src/**/*.ts <= 500 lines per file)
npm run test:coverage  # build + coverage threshold guard (>= 85% line coverage)
npm run prepack        # build + test (npm runs this before `npm pack`)
```

Targeted test subsets:

```bash
npm run test:bridge    # core bridge tests only
npm run check:bridge   # syntax-check the legacy shims without booting Node
```

## Project layout

```
src/
  adapters/     one file per AI agent kind, plus registry.ts and the shared process-agent
  cli.ts        argv parser + command dispatch (run/main entry)
  cli-help.ts   overview + per-command help text
  cli-prepare.ts  shared prepareTask() (used by `prepare` and `setup --prepare`)
  cli-run.ts    run a participant
  cli-hook.ts    Antigravity hook (stdin JSON → review)
  cli-setup.ts   interactive scaffolder (--prepare chains into prepareTask)
  cli-utils.ts   emit, atomicWrite, appendTurn, readTurns, writeNeedsHuman
  context/       context-pack builder (CKAG-style packed context for agents)
  git/           getGitSnapshot (sha256 of repo root + base commit + diff + untracked)
  locks/         workspace lock (exclusive `wx` open of LOCK.json)
  schema/        validateCrewTaskDraft, validateCrewReview
  state/         StatePaths + JsonStateStore (atomic temp-then-rename writes)
  workflows/     workflow-registry + the three built-in workflows
  index.ts       public package exports
schemas/         JSON schema files used by adapters and the prepare hook
docs/            workflow + adapter reference, tutorial
tests/           node:test suites (`.test.mjs`)
packages/agent-bridge-core/  hidden CJS shim for backwards compatibility
scripts/         build/lint helpers, the agent-bridge launcher shim, coverage-check
```

## Code rules

- **One file ≤ 500 lines.** `npm run lint` walks `src/**/*.ts` and fails any file over the limit. Split before you grow.
- **CommonJS output.** `package.json` is `"type": "commonjs"` and `tsconfig.json` targets `ES2022`/`CommonJS`. Do not switch to ESM without updating the bin shims and tests.
- **Atomic writes.** All state files go through `atomicWrite` (temp-then-rename with `flag: 'wx'`). Do not bypass with `fs.writeFileSync` directly.
- **Validators own the shape.** New task or review fields flow through `src/schema/*.ts` and get a JSON schema entry in `schemas/`. Never trust raw input in CLI code.
- **No new deps without a reason.** The runtime has zero production dependencies; keep it that way. Dev deps are TypeScript + `@types/node` only.

## Coverage

`npm run test:coverage` runs [`scripts/coverage-check.cjs`](scripts/coverage-check.cjs), which:

1. Boots the full `node --test --experimental-test-coverage` run,
2. Parses the text coverage table (portable across Node 20/22/24),
3. Computes a weighted line-coverage aggregate over the shipped `dist/` source (`src/**/*.ts` line counts as weights), and
4. Fails if the aggregate falls below `85%` (override via `COVERAGE_THRESHOLD`).

Locally low files are flagged with `!` in the report. Per-file coverage is informational; only the weighted aggregate fails the build.

## Tests

- Tests live in `tests/*.test.mjs` and run as plain Node test modules — no test runner install needed.
- CLI tests spawn `dist/cli.js` via `spawnSync`, so always `npm run build` before iterating on CLI tests.
- `tests/docs.test.mjs` requires every doc under `docs/workflows/`, `docs/adapters/`, and `docs/tutorial.md` to mention **setup**, **failure**, and **example**. Update docs alongside behavior changes.
- `tests/agent-bridge-package.test.mjs` asserts the root `README.md` mentions `Setting Up a Bridge`, `agents-crew prepare`, `NEEDS_HUMAN.md`, and `READY.json` — keep those strings when refactoring the README.

## Workflow for a change

1. `npm run build` to refresh `dist/`.
2. `npm test` for the full suite (fast; ~15s).
3. `npm run lint` if you touched `src/`.
4. `npm run test:coverage` before release.
5. Update `CHANGELOG.md` under `## [Unreleased]` (or a new dated section if releasing).
6. Update `docs/` if behavior changed (the docs test will catch missing setup/failure/example keywords).
7. Update `agents-crew help <command>` text in `src/cli-help.ts` if a flag changed.

## Release flow

1. Bump `version` in `package.json`, `package-lock.json` (two spots), `packages/agent-bridge-core/package.json`, and `packageVersion` in `src/index.ts`.
2. Move `## [Unreleased]` entries in `CHANGELOG.md` to a `## [x.y.z] - YYYY-MM-DD` section; leave a fresh `## [Unreleased]` above it.
3. Re-run `npm run build`, `npm run lint`, `npm test`, `npm run test:coverage`.
4. Commit as `chore(release): vX.Y.Z`.
5. `git tag vX.Y.Z` on the release commit.
6. CI auto-publishes to npm on push to `main` (provenance, id-token, `NODE_AUTH_TOKEN`).
