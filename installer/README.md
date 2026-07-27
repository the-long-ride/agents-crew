# @agents-crew/installer

Downloads a prebuilt Agents Crew Rust binary from GitHub Releases, verifies it against `SHA256SUMS`, installs `crew` plus the `agents-crew` compatibility command, and generates one selected manager integration in the current repository.

```bash
npx @agents-crew/installer install --manager claude-code
```

Non-interactive CI or scripted install:

```bash
npx @agents-crew/installer install \
  --manager opencode \
  --yes
```

Install only the binaries:

```bash
npx @agents-crew/installer install --binary-only --yes
```

Global installation is also supported:

```bash
npm install --global @agents-crew/installer
agents-crew-install install --manager codex
```

The published package is built with its GitHub repository embedded. Source builds must pass `--repo owner/repository` or set `AGENTS_CREW_GITHUB_REPOSITORY`.

## Package development

Node.js 20 or newer can run the installer. Node.js 22.8 or newer is required for the built-in coverage threshold command; CI and releases use Node.js 24.

```bash
npm install --ignore-scripts --no-package-lock
npm run lint
npm test
npm run coverage
npm run pack:check
npm run check
```

Coverage must remain at or above 85% for lines, branches, and functions. See `../docs/releasing.md` for first-publish, npm scope ownership, trusted publishing, and tag-release instructions.
