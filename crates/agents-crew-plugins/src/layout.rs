use super::*;

pub(super) fn command_path(workspace: &Path, host: Host, name: &str) -> PathBuf {
    match host {
        Host::Codex => workspace.join(".codex/prompts").join(format!("{name}.md")),
        Host::ClaudeCode => workspace
            .join(".claude/commands")
            .join(format!("{name}.md")),
        Host::Opencode => workspace
            .join(".opencode/commands")
            .join(format!("{name}.md")),
        Host::Antigravity => workspace
            .join(".agents/plugins/agents-crew/skills")
            .join(name)
            .join("SKILL.md"),
    }
}

pub(super) fn role_agent_path(workspace: &Path, host: Host, role: Role) -> PathBuf {
    let name = format!("agents-crew-{}", role_name(role));
    match host {
        Host::Codex => workspace.join(".codex/agents").join(format!("{name}.md")),
        Host::ClaudeCode => workspace.join(".claude/agents").join(format!("{name}.md")),
        Host::Opencode => workspace
            .join(".opencode/agents")
            .join(format!("{name}.md")),
        Host::Antigravity => workspace
            .join(".agents/plugins/agents-crew/skills")
            .join(name)
            .join("SKILL.md"),
    }
}

pub(super) fn manager_path(workspace: &Path, host: Host) -> PathBuf {
    match host {
        Host::Codex => workspace.join(".codex/agents/agents-crew-manager.md"),
        Host::ClaudeCode => workspace.join(".claude/agents/agents-crew-manager.md"),
        Host::Opencode => workspace.join(".opencode/agents/agents-crew-manager.md"),
        Host::Antigravity => {
            workspace.join(".agents/plugins/agents-crew/rules/agents-crew-manager.md")
        }
    }
}

pub(super) fn manifest_path(workspace: &Path, host: Host) -> PathBuf {
    workspace
        .join(".agents-crew/plugin-manifests")
        .join(format!("{}.json", host.name()))
}

pub(super) fn relative(root: &Path, path: &Path) -> PathBuf {
    path.strip_prefix(root).unwrap_or(path).to_path_buf()
}
