use super::*;

pub(super) fn config_path(workspace: &Path) -> PathBuf {
    workspace.join(".agents-crew/config.toml")
}

pub(super) fn config(workspace: &Path) -> Result<CrewConfig> {
    CrewConfig::load(&config_path(workspace))
        .with_context(|| format!("load {}", config_path(workspace).display()))
}

pub(super) fn store(workspace: &Path) -> RunStore {
    RunStore::new(workspace)
}

pub(super) fn latest_id(workspace: &Path, requested: Option<&str>) -> Result<String> {
    if let Some(id) = requested {
        return Ok(id.to_string());
    }
    store(workspace)
        .latest_run_id()?
        .ok_or_else(|| anyhow!("no run found"))
}

pub(super) fn run_config(workspace: &Path, run_id: &str) -> Result<CrewConfig> {
    match RunProtocol::new(workspace).load_snapshot(run_id) {
        Ok(config) => Ok(config),
        Err(_) => config(workspace)
            .with_context(|| format!("load durable config for run {run_id}")),
    }
}

pub(super) fn persist_run(workspace: &Path, run: &Run) -> Result<()> {
    let run_store = store(workspace);
    run_store.save(run)?;
    let protocol = RunProtocol::new(workspace);
    if matches!(run.status, RunStatus::Completed | RunStatus::Cancelled) {
        if run_store.active_run_dir(&run.id).exists() {
            if let Ok(repository) = GitRepository::discover(workspace) {
                repository.cleanup_run_worktrees(&run.id)?;
            }
            protocol.archive_terminal(run)?;
        }
    } else {
        protocol.sync(run)?;
    }
    Ok(())
}
