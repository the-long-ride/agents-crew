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
