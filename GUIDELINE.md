# Contributor guideline

## Runtime contract

- Node.js 22.13+
- TypeScript runtime source under responsibility folders in `src/`; browser source under `ui/src/`
- Zero runtime and development dependencies
- `crew` and `agents-crew` must resolve to the same CLI
- Durable data remains under `.agents-crew/`
- Public JSON fields and command names remain backward compatible where practical

## Local checks

```bash
npm run build
npm link
npm run check
```

`npm run check` performs type checking, repository lint, unit/integration tests, coverage thresholds, delivery-contract checks, and an npm pack dry run.

## Design rules

Core policy must not live only in prompts. Add a TypeScript validation or policy check for every security, scheduling, capability, state-transition, or completion rule.

Keep modules focused:

- `src/cli/` owns argument parsing, command routing, and executable startup.
- `src/config/` owns TOML parsing, defaults, and configuration validation.
- `src/domain/` owns shared types, task scheduling, evidence verification, and policy.
- `src/orchestration/` owns run advancement, manager actions, projections, and run controls.
- `src/runtime/` owns Git isolation, persistence, locks, and worker adapters.
- `src/templates/` and `src/plugins/` own their registries and filesystem boundaries.
- `src/ui/` owns the authenticated loopback API and static server.
- `ui/src/` owns small browser modules for Builder, Templates, and Runtime.

Do not restore a flat `src/*.ts` runtime layout. Root-level TypeScript files are limited to the public export barrel and ambient Node declarations.

Write tests before behavior changes. Tests should verify real state/files/process behavior rather than only mocks.

## Security

- Never print credential values.
- Never run a shell string when an argument array is available.
- Keep API workers read-only.
- Validate changed paths against the declared write scope.
- Reject path traversal in both Git scope checks and UI static serving.
- Treat worker output as untrusted JSON.
- Preserve approval and action one-time-use semantics.

## Release checklist

1. Set `package.json` version.
2. Run `npm run check`.
3. Test `npm run build && npm link` in a clean checkout.
4. Inspect `npm pack --dry-run` output.
5. Push tag `v<package-version>`.
6. Confirm the GitHub Release contains the `.tgz` and `SHA256SUMS`.
7. Confirm `@agents-crew/cli` was published with provenance.
