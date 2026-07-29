use super::*;
use agents_crew_config::{CrewConfig, TemplateMetadata};
use agents_crew_core::{
    Capability, ManagerCoding, ManagerIdentity, Role, Task, TaskDraft, TaskStatus, WorkspaceMode,
};
use tempfile::tempdir;

fn setup() -> (tempfile::TempDir, Run, CrewConfig, RunIntent) {
    let directory = tempdir().unwrap();
    let mut run = Run::new(
        "Ship the feature",
        directory.path().into(),
        WorkspaceMode::Current,
        ManagerIdentity {
            host: "codex".to_string(),
            coding: ManagerCoding::SmallFixes,
            small_fix_max_files: 3,
            small_fix_max_changed_lines: 120,
        },
        8,
    );
    run.status = RunStatus::Working;
    let mut config = CrewConfig::starter();
    config.template = Some(TemplateMetadata {
        id: "test-crew".to_string(),
        name: "Test Crew".to_string(),
        description: String::new(),
        layout: std::collections::BTreeMap::new(),
    });
    let intent = RunIntent {
        template_id: "test-crew".to_string(),
        template_name: "Test Crew".to_string(),
        goal: "Ship the feature".to_string(),
        expectations: vec!["Keep compatibility".to_string()],
        acceptance_criteria: vec!["Tests pass".to_string()],
        constraints: Vec::new(),
    };
    (directory, run, config, intent)
}

#[test]
fn materialize_writes_goal_status_snapshot_and_host_protocol() {
    let (directory, run, config, intent) = setup();
    let store = RunStore::new(directory.path());
    store.create(&run).unwrap();
    let protocol = RunProtocol::new(directory.path());
    protocol.materialize(&run, &config, &intent).unwrap();
    let root = store.active_run_dir(&run.id);
    assert!(root.join(format!("goal-{}.md", run.id)).exists());
    assert!(root.join("status.md").exists());
    assert!(root.join("crew.snapshot.toml").exists());
    assert!(root.join("communication/host-instructions.md").exists());
    assert_eq!(
        protocol.load_snapshot(&run.id).unwrap().manager.host,
        config.manager.host
    );
}

#[test]
fn completed_archive_removes_spawn_context_but_preserves_history_and_source() {
    let (directory, mut run, config, intent) = setup();
    let source = directory.path().join("src-user.txt");
    fs::write(&source, "keep").unwrap();
    let store = RunStore::new(directory.path());
    store.create(&run).unwrap();
    let protocol = RunProtocol::new(directory.path());
    protocol.materialize(&run, &config, &intent).unwrap();
    run.status = RunStatus::Completed;
    store.save(&run).unwrap();
    let history = protocol.archive_terminal(&run).unwrap();
    assert!(history.join("summary.json").exists());
    assert!(history.join("final-status.md").exists());
    assert!(!history.join("communication").exists());
    assert_eq!(fs::read_to_string(source).unwrap(), "keep");
    assert_eq!(store.load(&run.id).unwrap().status, RunStatus::Completed);
}

#[test]
fn sync_records_assigned_agent_runtime_identity() {
    let (directory, mut run, config, intent) = setup();
    let mut task = Task::from_draft(
        "implement",
        TaskDraft {
            title: "Implement".to_string(),
            instructions: "Implement safely".to_string(),
            role: Role::Implementer,
            capabilities: [Capability::Read, Capability::Write].into(),
            write_scope: vec!["src".into()],
            dependencies: Vec::new(),
            preferred_workers: Vec::new(),
            expected_output: "changes".to_string(),
            max_attempts: 2,
        },
    );
    task.status = TaskStatus::Running;
    task.assigned_worker = Some("opencode/implementer".to_string());
    run.tasks.insert(task.id.clone(), task);
    let store = RunStore::new(directory.path());
    store.create(&run).unwrap();
    let protocol = RunProtocol::new(directory.path());
    protocol.materialize(&run, &config, &intent).unwrap();
    let root = store.active_run_dir(&run.id);
    assert!(root.join("agents.json").exists());
    assert!(root.join("agents/opencode-implementer/session.json").exists());
}

#[test]
fn failed_run_is_not_archived_or_cleaned() {
    let (directory, mut run, config, intent) = setup();
    let store = RunStore::new(directory.path());
    store.create(&run).unwrap();
    let protocol = RunProtocol::new(directory.path());
    protocol.materialize(&run, &config, &intent).unwrap();
    run.status = RunStatus::Failed;
    assert!(matches!(
        protocol.archive_terminal(&run),
        Err(ProtocolError::NotArchivable)
    ));
    assert!(store.active_run_dir(&run.id).join("communication").exists());
}
