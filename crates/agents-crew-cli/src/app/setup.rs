use super::*;

pub(super) fn init(workspace: &Path, args: InitArgs) -> Result<Value> {
    fs::create_dir_all(workspace.join(".agents-crew/roles"))?;
    fs::create_dir_all(workspace.join(".agents-crew/runs"))?;
    let path = config_path(workspace);
    if !path.exists() || args.force {
        CrewConfig::starter().save(&path)?;
    }
    for role_kind in [
        Role::Manager,
        Role::Planner,
        Role::Researcher,
        Role::Implementer,
        Role::Tester,
        Role::Reviewer,
        Role::Integrator,
    ] {
        let name = format!("{role_kind:?}").to_lowercase();
        let role_path = workspace
            .join(".agents-crew/roles")
            .join(format!("{name}.md"));
        if !role_path.exists() || args.force {
            fs::write(role_path, role(role_kind))?;
        }
    }
    Ok(json!({
        "initialized": true,
        "config": path,
        "non_interactive": args.non_interactive,
        "next": [
            "crew plugin install <host>",
            "crew doctor"
        ]
    }))
}

pub(super) fn plan(workspace: &Path, goal: &str) -> Result<Value> {
    let cfg = config(workspace)?;
    let run = build_default_run(workspace, goal, &cfg);
    Ok(json!({
        "run": run,
        "note": "The manager protocol may replace this deterministic starter DAG with a richer plan."
    }))
}

pub(super) fn build_default_run(workspace: &Path, goal: &str, cfg: &CrewConfig) -> Run {
    let manager = ManagerIdentity {
        host: cfg.manager.host.clone(),
        coding: cfg.manager.coding,
        small_fix_max_files: cfg.manager.small_fix_max_files,
        small_fix_max_changed_lines: cfg.manager.small_fix_max_changed_lines,
    };
    let mut run = create_run(
        goal.to_string(),
        workspace.to_path_buf(),
        cfg.run.workspace_mode,
        manager,
        cfg.run.max_iterations,
    );
    run.acceptance_criteria = vec![AcceptanceCriterion {
        id: "goal".to_string(),
        description: format!(
            "The requested goal is implemented and independently verified: {goal}"
        ),
        required_checks: cfg
            .verification
            .commands
            .iter()
            .map(|command| command.join(" "))
            .collect(),
    }];
    let research = Task::from_draft(
        "research",
        TaskDraft {
            title: "Inspect repository and define implementation boundaries".to_string(),
            instructions: format!(
                "Inspect the repository and return risks, relevant files, and a bounded implementation approach for: {goal}"
            ),
            role: Role::Researcher,
            capabilities: [Capability::Read].into(),
            write_scope: Vec::new(),
            dependencies: Vec::new(),
            preferred_workers: Vec::new(),
            expected_output: "Repository findings and implementation boundaries".to_string(),
            max_attempts: 2,
        },
    );
    let implement = Task::from_draft(
        "implement",
        TaskDraft {
            title: "Implement the goal".to_string(),
            instructions: format!("Implement this goal completely and safely: {goal}"),
            role: Role::Implementer,
            capabilities: [Capability::Read, Capability::Write, Capability::Shell].into(),
            write_scope: vec![PathBuf::from(".")],
            dependencies: vec!["research".to_string()],
            preferred_workers: Vec::new(),
            expected_output: "Code changes and local verification evidence".to_string(),
            max_attempts: 2,
        },
    );
    let review = Task::from_draft(
        "review",
        TaskDraft {
            title: "Review and verify the implementation".to_string(),
            instructions: format!("Review all changes against this goal: {goal}"),
            role: Role::Reviewer,
            capabilities: [Capability::Read, Capability::Shell].into(),
            write_scope: Vec::new(),
            dependencies: vec!["implement".to_string()],
            preferred_workers: Vec::new(),
            expected_output: "Independent findings and criterion evidence".to_string(),
            max_attempts: 2,
        },
    );
    run.tasks = [
        (research.id.clone(), research),
        (implement.id.clone(), implement),
        (review.id.clone(), review),
    ]
    .into();
    run.status = RunStatus::Working;
    run
}

pub(super) async fn run_goal(workspace: &Path, goal: &str) -> Result<Value> {
    let cfg = config(workspace)?;
    let mut run = build_default_run(workspace, goal, &cfg);
    let run_store = store(workspace);
    run_store.create(&run)?;
    run_store.append_event(&run.id, EventKind::RunStarted, json!({ "goal": goal }))?;
    advance_run(workspace, &cfg, &mut run).await?;
    run_store.save(&run)?;
    Ok(run_response(workspace, &run)?)
}
