# Installation

## npm

Agents Crew is one portable npm package:

```bash
npm install --global @agents-crew/cli
crew --version
agents-crew --version
```

Node.js 22.13 or newer is required. Git is required for repository and worktree features. No Rust toolchain or downloaded platform binary is used.

## Source checkout

```bash
git clone <repository-url>
cd agents-crew
npm run build
npm link
```

There are no package dependencies, so `npm install` is not required for the normal local build/link loop.

## Initialize a repository

```bash
cd your-project
crew init --non-interactive
crew plugin install claude-code
crew doctor
```

Replace `claude-code` with `codex`, `opencode`, or `antigravity` as needed. Only the chosen manager host receives generated plugin files; worker tools do not install Agents Crew.

## Upgrade

```bash
npm install --global @agents-crew/cli@latest
crew doctor
```

Run `crew plugin install <host> --force` only when you intentionally want to regenerate host files. Unmodified generated files can be removed safely with `crew plugin uninstall <host>`.
