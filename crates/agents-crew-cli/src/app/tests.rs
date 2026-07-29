use super::*;
use tempfile::tempdir;

fn test_run(workspace: &Path, coding: ManagerCoding) -> Run {
    create_run(
        "test goal".to_string(),
        workspace.to_path_buf(),
        WorkspaceMode::Current,
        ManagerIdentity {
            host: "test".to_string(),
            coding,
            small_fix_max_files: 1,
            small_fix_max_changed_lines: 10,
        },
        4,
    )
}

fn test_task(id: &str, role_kind: Role, writes: bool) -> Task {
    Task::from_draft(
        id,
        TaskDraft {
            title: id.to_string(),
            instructions: "perform bounded work".to_string(),
            role: role_kind,
            capabilities: if writes {
                [Capability::Read, Capability::Write].into()
            } else {
                [Capability::Read].into()
            },
            write_scope: if writes {
                vec![PathBuf::from("src/example.rs")]
            } else {
                Vec::new()
            },
            dependencies: Vec::new(),
            preferred_workers: Vec::new(),
            expected_output: "evidence".to_string(),
            max_attempts: 2,
        },
    )
}

#[test]
fn manager_coding_limit_does_not_block_native_implementer_subagent() {
    let directory = tempdir().unwrap();
    let run = test_run(directory.path(), ManagerCoding::Never);
    assert!(enforce_manager_coding(&run, &test_task("implement", Role::Implementer, true)).is_ok());
    assert!(enforce_manager_coding(&run, &test_task("manager-edit", Role::Manager, true)).is_err());
}

#[test]
fn independent_review_must_use_worker_distinct_from_every_writer() {
    let directory = tempdir().unwrap();
    let mut run = test_run(directory.path(), ManagerCoding::Full);
    let mut writer = test_task("write", Role::Integrator, true);
    writer.status = TaskStatus::Completed;
    writer.assigned_worker = Some("same-worker".to_string());
    let mut reviewer = test_task("review", Role::Reviewer, false);
    reviewer.status = TaskStatus::Completed;
    reviewer.assigned_worker = Some("same-worker".to_string());
    run.tasks.insert(writer.id.clone(), writer);
    run.tasks.insert(reviewer.id.clone(), reviewer);
    assert!(!has_independent_review(&run));
    run.tasks.get_mut("review").unwrap().assigned_worker = Some("other-worker".to_string());
    assert!(has_independent_review(&run));
}

#[test]
fn interrupted_task_requires_manager_recovery_review() {
    let directory = tempdir().unwrap();
    let mut run = test_run(directory.path(), ManagerCoding::Full);
    let mut task = test_task("write", Role::Implementer, true);
    task.status = TaskStatus::Running;
    run.tasks.insert(task.id.clone(), task);
    let run_store = store(directory.path());
    run_store.create(&run).unwrap();

    assert!(recover_interrupted_tasks(directory.path(), &mut run).unwrap());
    assert_eq!(run.status, RunStatus::ManagerRequired);
    assert_eq!(run.tasks["write"].status, TaskStatus::Blocked);
    let actions = run_store.pending_actions(&run.id).unwrap();
    assert_eq!(actions.len(), 1);
    assert!(matches!(&actions[0].action, ManagerAction::Review { .. }));
}

#[test]
fn retry_fingerprint_survives_running_transition() {
    let _directory = tempdir().unwrap();
    let mut task = test_task("retry", Role::Implementer, true);
    task.attempt = 1;
    task.status = TaskStatus::Running;
    let fingerprint = strategy_fingerprint("worker", Some("model"), &task, WorkspaceMode::Current);
    task.strategy_fingerprint = Some(fingerprint.clone());
    assert!(is_unchanged_retry(&task, &fingerprint));
}

#[test]
fn safe_local_edit_creates_approval_boundary() {
    let directory = tempdir().unwrap();
    let mut cfg = CrewConfig::starter();
    cfg.permissions.local_edit = agents_crew_config::PermissionRule::Ask;
    let run = test_run(directory.path(), ManagerCoding::Full);
    let task = test_task("write", Role::Implementer, true);
    assert!(matches!(
        enforce_task_policy(&cfg, &run, &task).unwrap(),
        Some(Execution::Approval(_))
    ));
}

#[test]
fn failed_run_recovery_issues_durable_manager_review() {
    let directory = tempdir().unwrap();
    let mut run = test_run(directory.path(), ManagerCoding::Full);
    let mut task = test_task("failed", Role::Implementer, true);
    task.status = TaskStatus::Failed;
    run.tasks.insert(task.id.clone(), task);
    run.status = RunStatus::Failed;
    let run_store = store(directory.path());
    run_store.create(&run).unwrap();

    create_failed_run_recovery(directory.path(), &mut run).unwrap();

    assert_eq!(run.status, RunStatus::ManagerRequired);
    let actions = run_store.pending_actions(&run.id).unwrap();
    assert_eq!(actions.len(), 1);
    assert!(matches!(actions[0].action, ManagerAction::Review { .. }));
}

#[test]
fn repeated_terminal_persistence_does_not_restore_generated_context() {
    let directory = tempdir().unwrap();
    let mut run = test_run(directory.path(), ManagerCoding::Full);
    let cfg = CrewConfig::starter();
    let run_store = store(directory.path());
    run_store.create(&run).unwrap();
    RunProtocol::new(directory.path())
        .materialize(
            &run,
            &cfg,
            &RunIntent {
                template_id: "default".to_string(),
                template_name: "Default crew".to_string(),
                goal: run.goal.clone(),
                expectations: Vec::new(),
                acceptance_criteria: Vec::new(),
                constraints: Vec::new(),
            },
        )
        .unwrap();
    run.status = RunStatus::Completed;

    persist_run(directory.path(), &run).unwrap();
    persist_run(directory.path(), &run).unwrap();

    let history = run_store.history_run_dir(&run.id);
    assert!(history.join("summary.json").exists());
    assert!(!history.join("context").exists());
    assert!(!history.join("tasks").exists());
    assert!(!history.join("communication").exists());
}
