use agents_crew_config::CrewConfig;
use agents_crew_core::{Run, RunStatus, TaskStatus};
use agents_crew_state::RunStore;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use thiserror::Error;

mod agents;
mod render;
use agents::sync_agents;
use render::{render_goal, render_host_instructions, render_status};

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("toml decode: {0}")]
    Decode(#[from] toml::de::Error),
    #[error("toml encode: {0}")]
    Encode(#[from] toml::ser::Error),
    #[error("state: {0}")]
    State(#[from] agents_crew_state::StateError),
    #[error("run is not terminal and cannot be archived")]
    NotArchivable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunIntent {
    pub template_id: String,
    pub template_name: String,
    pub goal: String,
    #[serde(default)]
    pub expectations: Vec<String>,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunHistorySummary {
    pub run_id: String,
    pub template_id: String,
    pub goal: String,
    pub status: RunStatus,
    pub manager_host: String,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
    pub completed_tasks: usize,
    pub total_tasks: usize,
    pub terminal_summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RunProtocol {
    workspace: PathBuf,
    store: RunStore,
}

impl RunProtocol {
    #[must_use]
    pub fn new(workspace: &Path) -> Self {
        Self {
            workspace: workspace.to_path_buf(),
            store: RunStore::new(workspace),
        }
    }

    pub fn materialize(
        &self,
        run: &Run,
        config: &CrewConfig,
        intent: &RunIntent,
    ) -> Result<(), ProtocolError> {
        let directory = self.store.active_run_dir(&run.id);
        for child in [
            "actions",
            "artifacts",
            "context",
            "tasks",
            "agents",
            "communication",
            "decisions",
            "blockers",
            "evidence",
        ] {
            fs::create_dir_all(directory.join(child))?;
        }
        atomic_write(
            &directory.join("crew.snapshot.toml"),
            toml::to_string_pretty(config)?.as_bytes(),
        )?;
        atomic_json(&directory.join("intent.json"), intent)?;
        atomic_write(
            &directory.join(format!("goal-{}.md", run.id)),
            render_goal(run, intent).as_bytes(),
        )?;
        atomic_write(
            &directory.join("communication/host-instructions.md"),
            render_host_instructions(run).as_bytes(),
        )?;
        self.sync(run)
    }

    pub fn sync(&self, run: &Run) -> Result<(), ProtocolError> {
        let directory = self.store.run_dir(&run.id);
        atomic_write(&directory.join("status.md"), render_status(run).as_bytes())?;
        for task in run.tasks.values() {
            atomic_json(&directory.join("tasks").join(format!("{}.json", task.id)), task)?;
            let assignment = format!(
                "# Assignment: {}\n\n- Task ID: `{}`\n- Role: `{:?}`\n- Status: `{:?}`\n- Worker: `{}`\n- Expected output: {}\n\n## Instructions\n\n{}\n",
                task.title,
                task.id,
                task.role,
                task.status,
                task.assigned_worker.as_deref().unwrap_or("unassigned"),
                task.expected_output,
                task.instructions
            );
            atomic_write(
                &directory
                    .join("context")
                    .join(format!("task-{}.md", task.id)),
                assignment.as_bytes(),
            )?;
        }
        sync_agents(&directory, run)?;
        Ok(())
    }

    pub fn load_snapshot(&self, run_id: &str) -> Result<CrewConfig, ProtocolError> {
        let raw = fs::read_to_string(self.store.run_dir(run_id).join("crew.snapshot.toml"))?;
        Ok(toml::from_str(&raw)?)
    }

    pub fn load_intent(&self, run_id: &str) -> Result<RunIntent, ProtocolError> {
        let raw = fs::read(self.store.run_dir(run_id).join("intent.json"))?;
        Ok(serde_json::from_slice(&raw)?)
    }

    pub fn archive_terminal(&self, run: &Run) -> Result<PathBuf, ProtocolError> {
        if !matches!(run.status, RunStatus::Completed | RunStatus::Cancelled) {
            return Err(ProtocolError::NotArchivable);
        }
        self.sync(run)?;
        let directory = self.store.active_run_dir(&run.id);
        let intent = self.load_intent(&run.id).ok();
        let summary = RunHistorySummary {
            run_id: run.id.clone(),
            template_id: intent
                .as_ref()
                .map_or_else(|| "unknown".to_string(), |item| item.template_id.clone()),
            goal: run.original_goal.clone(),
            status: run.status,
            manager_host: run.manager.host.clone(),
            created_at: run.created_at,
            updated_at: run.updated_at,
            completed_tasks: run
                .tasks
                .values()
                .filter(|task| task.status == TaskStatus::Completed)
                .count(),
            total_tasks: run.tasks.len(),
            terminal_summary: run.terminal_summary.clone(),
        };
        atomic_json(&directory.join("summary.json"), &summary)?;
        atomic_write(
            &directory.join("final-status.md"),
            render_status(run).as_bytes(),
        )?;
        let files = generated_file_index(&directory)?;
        atomic_json(&directory.join("files.json"), &files)?;
        for child in ["actions", "context", "tasks", "communication"] {
            let path = directory.join(child);
            if path.exists() {
                fs::remove_dir_all(path)?;
            }
        }
        Ok(self.store.archive(&run.id)?)
    }

    #[must_use]
    pub fn workspace(&self) -> &Path {
        &self.workspace
    }
}

fn generated_file_index(root: &Path) -> Result<Vec<PathBuf>, ProtocolError> {
    fn walk(root: &Path, current: &Path, result: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in fs::read_dir(current)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, result)?;
            } else if let Ok(relative) = path.strip_prefix(root) {
                result.push(relative.to_path_buf());
            }
        }
        Ok(())
    }
    let mut result = Vec::new();
    walk(root, root, &mut result)?;
    result.sort();
    Ok(result)
}

pub(crate) fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), ProtocolError> {
    atomic_write(path, format!("{}\n", serde_json::to_string_pretty(value)?).as_bytes())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), ProtocolError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests;
