use super::*;

#[test]
fn all_hosts_generate_commands() {
    let root = Path::new("/repo");
    for host in Host::ALL {
        let files = HostPlugin::new(host).plan_files(root);
        for (name, _) in COMMANDS {
            assert!(files
                .iter()
                .any(|(path, _)| path.to_string_lossy().contains(name)));
        }
        for role_name in [
            "planner",
            "researcher",
            "implementer",
            "tester",
            "reviewer",
            "integrator",
        ] {
            assert!(files.iter().any(|(path, content)| {
                path.to_string_lossy().contains(role_name) && content.contains("#")
            }));
        }
    }
}

#[test]
fn run_command_uses_manager_protocol() {
    let text = command_content(Host::ClaudeCode, "crew-run", "run");
    assert!(text.contains("manager start"));
    assert!(text.contains("manager step"));
    assert!(text.contains("manager submit"));
}

#[test]
fn unified_agents_crew_command_supports_template_start_and_resume() {
    for host in Host::ALL {
        let text = command_content(host, "agents-crew", "durable crew command");
        assert!(text.contains("start <template-id>"));
        assert!(text.contains("resume <run-id>"));
        assert!(text.contains("goal-<run-id>.md"));
        assert!(text.contains("manager submit"));
    }
}

#[test]
fn manager_prompt_requires_durable_status_context() {
    let text = manager_content(Host::Codex);
    assert!(text.contains("goal and status projections"));
    assert!(text.contains("Rust core is the authority"));
}
