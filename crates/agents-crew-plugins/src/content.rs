use super::*;

pub(super) fn role_name(role: Role) -> &'static str {
    match role {
        Role::Manager => "manager",
        Role::Planner => "planner",
        Role::Researcher => "researcher",
        Role::Implementer => "implementer",
        Role::Tester => "tester",
        Role::Reviewer => "reviewer",
        Role::Integrator => "integrator",
    }
}

pub(super) fn role_can_write(role: Role) -> bool {
    matches!(role, Role::Implementer | Role::Integrator)
}

pub(super) fn role_agent_content(host: Host, role_kind: Role) -> String {
    let name = format!("agents-crew-{}", role_name(role_kind));
    let description = format!("Agents Crew {} role", role_name(role_kind));
    let front_matter = match host {
        Host::Codex => String::new(),
        Host::ClaudeCode => {
            let tools = if role_can_write(role_kind) {
                "Read, Write, Edit, Bash"
            } else {
                "Read, Bash"
            };
            format!("---\nname: {name}\ndescription: {description}\ntools: {tools}\n---\n\n")
        }
        Host::Opencode => {
            let edit = if role_can_write(role_kind) {
                "allow"
            } else {
                "deny"
            };
            format!(
                "---\ndescription: {description}\nmode: subagent\npermission:\n  edit: {edit}\n  bash: allow\n---\n\n"
            )
        }
        Host::Antigravity => format!("---\nname: {name}\ndescription: {description}\n---\n\n"),
    };
    format!(
        "{front_matter}{}\n\nObey the capability envelope, workspace, context file, and output schema supplied by the Rust manager action. Return only the requested normalized result.",
        role(role_kind)
    )
}

pub(super) fn command_content(host: Host, name: &str, description: &str) -> String {
    let front_matter = match host {
        Host::Opencode => {
            format!("---\ndescription: {description}\nagent: agents-crew-manager\n---\n\n")
        }
        Host::ClaudeCode => format!("---\ndescription: {description}\n---\n\n"),
        Host::Antigravity => format!("---\nname: {name}\ndescription: {description}\n---\n\n"),
        Host::Codex => String::new(),
    };
    let body = match name {
        "crew-run" => format!(
            "Start with `crew manager start --goal \"$ARGUMENTS\" --host {} --json`. Follow only returned actions. For `plan` or `review`, write the requested schema to a temporary JSON file and submit it via `crew manager submit`. For `dispatch_native`, invoke the generated `agents-crew-<role>` subagent (or inject `.agents-crew/roles/<role>.md`) with exactly the capability envelope and workspace, then submit normalized WorkerResult JSON via `crew manager submit`. Repeatedly run `crew manager step --run <run-id> --json` until completed, approval is needed, or blocked. Never invent action IDs or bypass the Rust policy engine.\n",
            host.name()
        ),
        "crew-plan" => "Run `crew --json plan $ARGUMENTS`. Explain the task DAG, workers, write scopes, approvals, and verification without making implementation changes.\n".to_string(),
        "crew-init" => "Run `crew init --non-interactive --json`, then `crew doctor --json`. Explain any unavailable worker or missing credential without exposing secret values.\n".to_string(),
        "crew-status" => "Run `crew status $ARGUMENTS --json` and summarize run state, task state, approvals, pending manager actions, and blockers.\n".to_string(),
        "crew-resume" => "Run `crew resume $ARGUMENTS --json`, then continue the manager action loop when an action is returned.\n".to_string(),
        "crew-pause" => "Run `crew pause $ARGUMENTS --json`.\n".to_string(),
        "crew-approve" => "Run `crew approve $ARGUMENTS --json`. Approve only the exact pending action named by the user.\n".to_string(),
        "crew-reject" => "Run `crew reject $ARGUMENTS --json`.\n".to_string(),
        "crew-cancel" => "Run `crew cancel $ARGUMENTS --json`.\n".to_string(),
        "crew-doctor" => "Run `crew doctor --json` and report actionable failures. Never print credential values.\n".to_string(),
        "crew-config" => "Run `crew config validate --json`, then `crew config show --json`. Explain routing, models, workspace mode, manager coding authority, permissions, and verification.\n".to_string(),
        _ => unreachable!("known command"),
    };
    format!("{front_matter}{body}")
}

pub(super) fn manager_content(host: Host) -> String {
    let front_matter = match host {
        Host::Opencode => {
            "---\ndescription: Coordinates Agents Crew runs\nmode: primary\npermission:\n  edit: allow\n  bash: ask\n  task: allow\n---\n\n"
        }
        Host::ClaudeCode => {
            "---\nname: agents-crew-manager\ndescription: Coordinates Agents Crew runs\ntools: Read, Write, Edit, Bash, Task\n---\n\n"
        }
        Host::Codex | Host::Antigravity => "",
    };
    format!(
        "{front_matter}# Agents Crew Manager\n\nYou are the only installed manager. The Rust core is the authority for scheduling, policy, retries, workspaces, action IDs, and completion. Plan, delegate, review, and implement only as permitted by `.agents-crew/config.toml`. Workers may be native subagents, Codex, Claude Code, OpenCode, Antigravity, or configured APIs. Execute only actions returned by `crew manager step`. Native results must match `schemas/worker-result.schema.json`. Do not claim completion until the core returns `completed`. Host: {}.\n",
        host.name()
    )
}
