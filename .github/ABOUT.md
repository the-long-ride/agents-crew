# Agents Crew automation

- `ci.yml` installs pnpm from `packageManager`, verifies the dependency-free TypeScript package on Linux, macOS, and Windows, then smoke-tests npm linking.
- `manual-build.yml` verifies with pnpm and creates a checked npm tarball from a selected branch.
- `release.yml` verifies with pnpm, creates the npm tarball and checksums, uploads a GitHub Release, and publishes the exact `@agents-crew/cli` artifact to npm.
