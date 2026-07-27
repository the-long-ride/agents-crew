use super::*;

pub(super) async fn execute_task(
    workspace: &Path,
    cfg: &CrewConfig,
    router: &WorkerRouter,
    run: &Run,
    task: &Task,
) -> Result<Execution> {
    if let Some(execution) = enforce_task_policy(cfg, run, task)? {
        return Ok(execution);
    }
    let routing = RoutingContext {
        workspace_mode: run.workspace_mode,
        required_model: None,
        model_fallback: ModelFallback::AllowHostDefault,
        remaining_budget: None,
    };

    match router.select(task, &routing).await {
        Ok(worker) => {
            execute_external_worker(
                workspace,
                cfg,
                run,
                task,
                worker,
            )
            .await
        }
        Err(_) => {
            let native = select_native_worker(cfg, task)
                .ok_or_else(|| anyhow!("no eligible worker for task {}", task.id))?;
            if task.role == Role::Manager {
                enforce_manager_coding(run, task)?;
            }
            let worker_id = native.id.clone();
            let fingerprint = strategy_fingerprint(
                &worker_id,
                native.model.as_deref(),
                task,
                run.workspace_mode,
            );
            if is_unchanged_retry(task, &fingerprint)
            {
                return Ok(Execution::Failure {
                    task_id: task.id.clone(),
                    message: "retry rejected because native worker, model, instructions, and workspace strategy are unchanged".to_string(),
                    workspace: None,
                    worker_id: Some(worker_id),
                    fingerprint: Some(fingerprint),
                });
            }
            let task_workspace = prepare_task_workspace(workspace, run, task)?;
            let (context_path, output_path) = prepare_task_files(&task_workspace, run, task)?;
            if run.workspace_mode == WorkspaceMode::Current || !task.writes() {
                let snapshot = GitRepository::discover(&task_workspace)?.snapshot()?;
                let snapshot_path = native_snapshot_path(workspace, &run.id, &task.id);
                if let Some(parent) = snapshot_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(snapshot_path, serde_json::to_vec_pretty(&snapshot)?)?;
            }
            let request = WorkerRequest {
                run_id: run.id.clone(),
                task: task.clone(),
                workspace: task_workspace.clone(),
                context_path,
                output_path,
                role_prompt: role(task.role).to_string(),
                model: native.model.clone(),
                model_fallback: native
                    .model_fallback
                    .unwrap_or(ModelFallback::AllowHostDefault),
                timeout_seconds: native
                    .timeout_seconds
                    .unwrap_or(cfg.run.default_task_timeout_seconds),
                workspace_mode: run.workspace_mode,
            };
            let action = NativeBridge::new(store(workspace)).issue(&request)?;
            Ok(Execution::Native {
                action,
                workspace: isolated_binding(run, task, task_workspace),
                worker_id,
                fingerprint,
            })
        }
    }
}

pub(super) fn prepare_task_files(
    workspace: &Path,
    run: &Run,
    task: &Task,
) -> Result<(PathBuf, PathBuf)> {
    let context_path = workspace
        .join(".agents-crew/runs")
        .join(&run.id)
        .join("context")
        .join(format!("{}.md", task.id));
    if let Some(parent) = context_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let criteria = run
        .acceptance_criteria
        .iter()
        .map(|criterion| format!("- {}: {}", criterion.id, criterion.description))
        .collect::<Vec<_>>()
        .join("\n");
    let repository = GitRepository::discover(workspace)?;
    let tracked = repository
        .tracked_files()?
        .into_iter()
        .take(500)
        .map(|path| format!("- {}", path.display()))
        .collect::<Vec<_>>()
        .join("\n");
    let mut selected = String::new();
    let mut remaining = 96 * 1024usize;
    for input in &task.inputs {
        if remaining == 0 {
            break;
        }
        let path = canonical_scoped_path(repository.root(), input)?;
        if !path.is_file() {
            continue;
        }
        let bytes = fs::read(&path)?;
        let take = bytes.len().min(remaining);
        let text = String::from_utf8_lossy(&bytes[..take]);
        selected.push_str(&format!(
            "\n## {}\n```text\n{}\n```\n",
            input.display(),
            text
        ));
        remaining -= take;
    }
    if selected.is_empty() {
        selected.push_str("\nNo file contents were selected for this task.\n");
    }
    fs::write(
        &context_path,
        format!(
            "# Goal\n{}\n\n# Task\n{}\n\n# Acceptance criteria\n{}\n\n# Tracked files (first 500)\n{}\n\n# Selected input contents\n{}",
            run.normalized_goal, task.instructions, criteria, tracked, selected
        ),
    )?;
    let output_path = workspace
        .join(".agents-crew/runs")
        .join(&run.id)
        .join("artifacts")
        .join(format!("{}-result.json", task.id));
    Ok((context_path, output_path))
}

pub(super) async fn execute_external_worker(
    workspace: &Path,
    cfg: &CrewConfig,
    run: &Run,
    task: &Task,
    worker: Arc<dyn Worker>,
) -> Result<Execution> {
    if let Some(execution) =
        enforce_worker_transport_policy(cfg, run, task, worker.descriptor())?
    {
        return Ok(execution);
    }
    let task_workspace = prepare_task_workspace(workspace, run, task)?;
    let (context_path, output_path) = prepare_task_files(&task_workspace, run, task)?;
    let worker_id = worker.descriptor().id.clone();
    let fingerprint = strategy_fingerprint(
        &worker_id,
        worker.descriptor().configured_model.as_deref(),
        task,
        run.workspace_mode,
    );
    if is_unchanged_retry(task, &fingerprint)
    {
        return Ok(Execution::Failure {
            task_id: task.id.clone(),
            message: "retry rejected because worker, model, instructions, and workspace strategy are unchanged".to_string(),
            workspace: isolated_binding(run, task, task_workspace),
            worker_id: Some(worker_id),
            fingerprint: Some(fingerprint),
        });
    }
    let task_repository = GitRepository::discover(&task_workspace).ok();
    let before = task_repository
        .as_ref()
        .and_then(|repository| repository.snapshot().ok());
    let request = WorkerRequest {
        run_id: run.id.clone(),
        task: task.clone(),
        workspace: task_workspace.clone(),
        context_path,
        output_path,
        role_prompt: role(task.role).to_string(),
        model: worker.descriptor().configured_model.clone(),
        model_fallback: ModelFallback::AllowHostDefault,
        timeout_seconds: cfg.run.default_task_timeout_seconds,
        workspace_mode: run.workspace_mode,
    };
    let mut result = match worker.execute(request).await {
        Ok(result) => result,
        Err(error) => {
            let changed = match (task_repository.as_ref(), before.as_ref()) {
                (Some(repository), Some(snapshot)) => {
                    repository.changed_files_since(snapshot).unwrap_or_default()
                }
                _ => Vec::new(),
            };
            let message = if changed.is_empty() {
                error.to_string()
            } else {
                format!(
                    "worker failed after modifying files: {changed:?}; original error: {error}"
                )
            };
            return Ok(Execution::Failure {
                task_id: task.id.clone(),
                message,
                workspace: isolated_binding(run, task, task_workspace),
                worker_id: Some(worker_id),
                fingerprint: Some(fingerprint),
            });
        }
    };
    if result.capabilities_used.is_empty() {
        result.capabilities_used = task.capabilities.clone();
    }
    let changed = match (task_repository.as_ref(), before.as_ref()) {
        (Some(repository), Some(snapshot)) => {
            repository.changed_files_since(snapshot).unwrap_or_default()
        }
        _ => Vec::new(),
    };
    if task.writes() {
        if let Some(repository) = task_repository.as_ref() {
            repository.validate_write_scope(&task.write_scope, &changed)?;
        }
    } else if !changed.is_empty() {
        return Ok(Execution::Failure {
            task_id: task.id.clone(),
            message: format!("read-only worker modified files: {changed:?}"),
            workspace: isolated_binding(run, task, task_workspace),
            worker_id: Some(worker_id),
            fingerprint: Some(fingerprint),
        });
    }
    result.files_changed = changed;

    let binding = isolated_binding(run, task, task_workspace.clone());
    let patch = if binding.is_some() && task.writes() {
        let patch_path = workspace
            .join(".agents-crew/runs")
            .join(&run.id)
            .join("artifacts")
            .join(format!("{}-changes.patch", task.id));
        GitRepository::discover(workspace)?.export_patch(&task_workspace, &patch_path)?;
        result.artifacts.push(patch_path.clone());
        Some(patch_path)
    } else {
        None
    };
    Ok(Execution::Result {
        result,
        workspace: binding,
        patch,
        worker_id,
        fingerprint,
    })
}
