use super::*;

pub(super) fn integrate_native_workspace(
    workspace: &Path,
    cfg: &CrewConfig,
    run: &mut Run,
    result: &mut WorkerResult,
) -> Result<()> {
    let task = run
        .tasks
        .get(&result.task_id)
        .cloned()
        .ok_or_else(|| anyhow!("missing task {}", result.task_id))?;

    if let Some(binding) = task.workspace_binding.as_ref() {
        let task_repository = GitRepository::discover(binding)?;
        let snapshot = task_repository.snapshot()?;
        let changed = snapshot.changed_files;
        if task.writes() {
            task_repository.validate_write_scope(&task.write_scope, &changed)?;
        } else if !changed.is_empty() {
            return Err(anyhow!(
                "read-only native worker modified files in isolated worktree: {changed:?}"
            ));
        }
        result.files_changed = changed.clone();
        if let Err(error) = verify_task_result(&task, result) {
            return Err(anyhow!(
                "native worker returned an invalid result in isolated worktree: {error}"
            ));
        }
        if task.writes() {
            let patch_path = native_patch_path(workspace, &run.id, &task.id);
            GitRepository::discover(workspace)?.export_patch(binding, &patch_path)?;
            enforce_native_change_budget(run, &task, changed.len(), &patch_path)?;
            GitRepository::discover(workspace)?.apply_patch(&patch_path)?;
            result.artifacts.push(patch_path);
        }
        if !cfg.run.retain_failed_worktrees || result.status == WorkerResultStatus::Completed {
            GitRepository::discover(workspace)?.cleanup_task_worktree(binding)?;
        }
        if let Some(task) = run.tasks.get_mut(&result.task_id) {
            task.workspace_binding = None;
        }
        return Ok(());
    }

    let repository = GitRepository::discover(workspace)?;
    let snapshot: RepositorySnapshot = serde_json::from_slice(&fs::read(
        native_snapshot_path(workspace, &run.id, &task.id),
    )?)?;
    let changed = repository.changed_files_since(&snapshot)?;
    if task.writes() {
        repository.validate_write_scope(&task.write_scope, &changed)?;
    } else if !changed.is_empty() {
        return Err(anyhow!("read-only native worker modified files: {changed:?}"));
    }
    result.files_changed = changed.clone();
    if let Err(error) = verify_task_result(&task, result) {
        if changed.is_empty() {
            return Err(error.into());
        }
        return Err(anyhow!(
            "native worker returned an invalid result after modifying files: {changed:?}; {error}"
        ));
    }
    if task.writes() {
        let patch_path = native_patch_path(workspace, &run.id, &task.id);
        repository.export_paths_patch(&changed, &patch_path)?;
        enforce_native_change_budget(run, &task, changed.len(), &patch_path)?;
        result.artifacts.push(patch_path);
    }
    Ok(())
}

pub(super) fn native_snapshot_path(workspace: &Path, run_id: &str, task_id: &str) -> PathBuf {
    workspace
        .join(".agents-crew/runs")
        .join(run_id)
        .join("context")
        .join(format!("{task_id}-before.json"))
}

pub(super) fn native_patch_path(workspace: &Path, run_id: &str, task_id: &str) -> PathBuf {
    workspace
        .join(".agents-crew/runs")
        .join(run_id)
        .join("artifacts")
        .join(format!("{task_id}-native.patch"))
}

pub(super) fn enforce_native_change_budget(
    run: &Run,
    task: &Task,
    changed_files: usize,
    patch: &Path,
) -> Result<()> {
    if !task.writes() || task.role != Role::Manager {
        return Ok(());
    }
    match run.manager.coding {
        ManagerCoding::Never => Err(anyhow!("manager-native writes are disabled")),
        ManagerCoding::Full => Ok(()),
        ManagerCoding::SmallFixes => {
            let changed_lines = fs::read_to_string(patch)?
                .lines()
                .filter(|line| {
                    (line.starts_with('+') && !line.starts_with("+++"))
                        || (line.starts_with('-') && !line.starts_with("---"))
                })
                .count();
            if changed_files > run.manager.small_fix_max_files
                || changed_lines > run.manager.small_fix_max_changed_lines
            {
                Err(anyhow!(
                    "manager-native change exceeds small-fix budget: {} files, {} changed lines",
                    changed_files,
                    changed_lines
                ))
            } else {
                Ok(())
            }
        }
    }
}
