use super::*;

pub(super) async fn doctor(workspace: &Path) -> Result<Value> {
    let cfg_result = config(workspace);
    let mut workers = Vec::new();
    if let Ok(cfg) = &cfg_result {
        for worker in &cfg.workers {
            let available = match worker.kind {
                WorkerKind::Native => true,
                WorkerKind::Cli => {
                    CliWorker::from_config(worker, cfg.run.default_task_timeout_seconds)?
                        .probe()
                        .await?
                        .available
                }
                WorkerKind::Api => ApiWorker::from_config(worker)?.probe().await?.available,
            };
            workers.push(json!({
                "id": worker.id,
                "kind": worker.kind,
                "available": available,
                "model": worker.model
            }));
        }
    }
    let git = GitRepository::discover(workspace)
        .map(|repository| json!({ "root": repository.root() }))
        .unwrap_or_else(|error| json!({ "error": error.to_string() }));
    Ok(json!({
        "binary_version": env!("CARGO_PKG_VERSION"),
        "config_valid": cfg_result.is_ok(),
        "config_error": cfg_result.err().map(|error| error.to_string()),
        "git": git,
        "workers": workers,
        "credentials": "Only environment-variable presence is reported; secret values are never printed."
    }))
}

pub(super) fn config_command(workspace: &Path, command: ConfigCommand) -> Result<Value> {
    let cfg = config(workspace)?;
    match command {
        ConfigCommand::Validate => {
            validate(&cfg)?;
            Ok(json!({ "valid": true }))
        }
        ConfigCommand::Show => Ok(serde_json::to_value(cfg)?),
    }
}

pub(super) fn plugin_command(workspace: &Path, command: PluginCommand) -> Result<Value> {
    match command {
        PluginCommand::List => Ok(json!({
            "hosts": Host::ALL.iter().map(|host| host.name()).collect::<Vec<_>>()
        })),
        PluginCommand::Install { host, force } => {
            let parsed = Host::parse(&host)?;
            let report = HostPlugin::new(parsed).install(workspace, force)?;
            let config_path = config_path(workspace);
            if config_path.exists() {
                let mut cfg = CrewConfig::load(&config_path)?;
                cfg.manager.host = parsed.name().to_string();
                cfg.save(&config_path)?;
            }
            Ok(serde_json::to_value(report)?)
        }
        PluginCommand::Doctor { host } => Ok(serde_json::to_value(
            HostPlugin::new(Host::parse(&host)?).doctor(workspace)?,
        )?),
        PluginCommand::Uninstall { host } => Ok(serde_json::to_value(
            HostPlugin::new(Host::parse(&host)?).uninstall(workspace)?,
        )?),
    }
}

pub(super) async fn worker_command(workspace: &Path, command: WorkerCommand) -> Result<Value> {
    let cfg = config(workspace)?;
    match command {
        WorkerCommand::Probe => doctor(workspace).await,
        WorkerCommand::Run { worker, task } => {
            if !cfg
                .workers
                .iter()
                .any(|candidate| candidate.enabled && candidate.id == worker)
            {
                return Err(anyhow!("enabled worker not found"));
            }
            let mut task: Task = serde_json::from_slice(&fs::read(task)?)?;
            task.preferred_workers = vec![worker];
            task.status = TaskStatus::Pending;
            task.attempt = 0;
            task.assigned_worker = None;
            task.workspace_binding = None;
            task.result = None;
            task.strategy_fingerprint = None;
            let manager = ManagerIdentity {
                host: cfg.manager.host.clone(),
                coding: cfg.manager.coding,
                small_fix_max_files: cfg.manager.small_fix_max_files,
                small_fix_max_changed_lines: cfg.manager.small_fix_max_changed_lines,
            };
            let mut run = create_run(
                format!("Execute task {} with selected worker", task.id),
                workspace.to_path_buf(),
                cfg.run.workspace_mode,
                manager,
                cfg.run.max_iterations,
            );
            run.acceptance_criteria = vec![AcceptanceCriterion {
                id: "goal".to_string(),
                description: task.expected_output.clone(),
                required_checks: Vec::new(),
            }];
            run.tasks.insert(task.id.clone(), task);
            run.status = RunStatus::Working;
            let run_store = store(workspace);
            run_store.create(&run)?;
            advance_run(workspace, &cfg, &mut run).await?;
            persist_run(workspace, &run)?;
            run_response(workspace, &run)
        }
    }
}
