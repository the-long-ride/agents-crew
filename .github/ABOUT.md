# Agents Crew automation

- `ci.yml` verifies the dependency-free TypeScript package on Linux, macOS, and Windows with supported Node versions.
- `manual-build.yml` creates a checked npm tarball from a selected branch.
- `release.yml` verifies a version tag, creates the npm tarball and checksums, uploads a GitHub Release, and publishes `@agents-crew/cli` to npm.
