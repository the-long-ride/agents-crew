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

The published package is built with its GitHub repository embedded. Source builds must pass `--repo owner/repository` or set `AGENTS_CREW_GITHUB_REPOSITORY`.
