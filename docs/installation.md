# Installation

Agents Crew uses a Rust runtime and a small TypeScript npm installer. Users install the manager integration in one repository and one AI host. Worker CLIs do not install this plugin.

## One-command setup

From the repository that should be managed:

```bash
npx @agents-crew/installer install --manager claude-code
```

Supported manager values:

```text
codex
claude-code
opencode
antigravity
```

Install globally when a reusable command is preferred:

```bash
npm install --global @agents-crew/installer
agents-crew-install install --manager codex
```

Without `--manager`, the installer asks interactively. For automation:

```bash
npx @agents-crew/installer install \
  --manager opencode \
  --yes
```

The installer performs these operations:

1. Detects operating system and CPU architecture.
2. Selects the matching GitHub Release archive.
3. Downloads the archive and `SHA256SUMS` over HTTPS.
4. Verifies the archive SHA-256 before extraction.
5. Rejects unsafe archive paths.
6. Installs `crew` and the `agents-crew` compatibility executable to `~/.agents-crew/bin` by default.
7. Runs `crew init --non-interactive` in the selected workspace.
8. Runs `crew plugin install <manager>` and `crew plugin doctor <manager>`.

No API credential is copied into an npm package, release archive, role prompt, or generated host file.

## PATH

Add the binary directory when it is not already in `PATH`.

macOS or Linux:

```bash
export PATH="$HOME/.agents-crew/bin:$PATH"
```

PowerShell:

```powershell
$env:Path = "$HOME\.agents-crew\bin;$env:Path"
```

Persist the change using the normal profile or environment-variable settings for your shell.

## Universal command

The direct command works even when the host has no slash commands:

```bash
crew run "Implement the goal and verify every acceptance criterion."
```

`agents-crew` executes the same binary and remains available for compatibility.

## Binary-only installation

Install the runtime without changing the current repository:

```bash
npx @agents-crew/installer install --binary-only --yes
```

Then initialize later:

```bash
crew init --non-interactive
crew plugin install codex
crew doctor --json
```

## Pin a release or repository

Published installer versions are intended to match Rust release tags. Overrides are available for testing forks:

```bash
npx @agents-crew/installer install \
  --repo owner/repository \
  --version 0.1.0 \
  --manager antigravity
```

Source builds of the installer must pass `--repo`, set `AGENTS_CREW_GITHUB_REPOSITORY`, or build with that environment variable so repository metadata is embedded.

## Custom locations

```bash
npx @agents-crew/installer install \
  --install-dir /custom/bin \
  --workspace /path/to/repository \
  --manager claude-code
```

`AGENTS_CREW_INSTALL_DIR` can provide the default install directory.

## Build from source

```bash
cargo install --path crates/agents-crew-cli --bins
```

This installs both `crew` and `agents-crew`. Building requires Rust 1.86 or newer; installing prebuilt release binaries does not.

## Upgrade

Run the installer for the new published version. Binary replacement is checksum-verified and atomic:

```bash
npx @agents-crew/installer@latest install --manager claude-code --yes
crew plugin doctor claude-code --json
crew doctor --json
```

Review modified generated plugin files before using `--force`; ownership protection intentionally refuses to overwrite unowned content.
