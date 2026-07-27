use super::*;

pub(super) fn prepare_task_workspace(workspace: &Path, run: &Run, task: &Task) -> Result<PathBuf> {
    if run.workspace_mode == WorkspaceMode::Isolated && task.writes() {
        if let Some(binding) = &task.workspace_binding {
            if binding.exists() {
                return Ok(binding.clone());
            }
        }
        return Ok(GitRepository::discover(workspace)?
            .create_task_worktree(&run.id, &task.id)?);
    }
    Ok(workspace.to_path_buf())
}

pub(super) fn isolated_binding(run: &Run, task: &Task, workspace: PathBuf) -> Option<PathBuf> {
    (run.workspace_mode == WorkspaceMode::Isolated && task.writes()).then_some(workspace)
}

pub(super) fn is_unchanged_retry(task: &Task, fingerprint: &str) -> bool {
    task.attempt > 0 && task.strategy_fingerprint.as_deref() == Some(fingerprint)
}

pub(super) fn strategy_fingerprint(
    worker_id: &str,
    model: Option<&str>,
    task: &Task,
    workspace_mode: WorkspaceMode,
) -> String {
    let mut hasher = DefaultHasher::new();
    worker_id.hash(&mut hasher);
    model.hash(&mut hasher);
    task.instructions.hash(&mut hasher);
    task.write_scope.hash(&mut hasher);
    workspace_mode.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(super) fn select_native_worker<'a>(cfg: &'a CrewConfig, task: &Task) -> Option<&'a WorkerConfig> {
    cfg.workers
        .iter()
        .filter(|worker| {
            worker.enabled
                && worker.kind == WorkerKind::Native
                && worker.roles.contains(&task.role)
                && task.capabilities.is_subset(&worker.capabilities)
        })
        .max_by_key(|worker| worker.priority)
}
