use crate::{EventKind, RunEvent};
use agents_crew_core::{Capability, ManagerAction, Run};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeSet, HashSet},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StateError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("run not found: {0}")]
    RunNotFound(String),
    #[error("run already archived: {0}")]
    AlreadyArchived(String),
    #[error("unknown action: {0}")]
    UnknownAction(String),
    #[error("action already consumed: {0}")]
    ActionConsumed(String),
    #[error("action expired: {0}")]
    ActionExpired(String),
    #[error("action capability mismatch")]
    CapabilityMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutstandingAction {
    pub id: String,
    pub run_id: String,
    pub task_id: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub capability_envelope: BTreeSet<Capability>,
    pub action: ManagerAction,
    pub consumed: bool,
}

#[derive(Debug, Clone)]
pub struct RunStore {
    active_root: PathBuf,
    history_root: PathBuf,
    legacy_root: PathBuf,
}

impl RunStore {
    #[must_use]
    pub fn new(workspace: &Path) -> Self {
        let base = workspace.join(".agents-crew");
        Self {
            active_root: base.join("active"),
            history_root: base.join("history"),
            legacy_root: base.join("runs"),
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.active_root
    }

    #[must_use]
    pub fn active_root(&self) -> &Path {
        &self.active_root
    }

    #[must_use]
    pub fn history_root(&self) -> &Path {
        &self.history_root
    }

    #[must_use]
    pub fn active_run_dir(&self, id: &str) -> PathBuf {
        self.active_root.join(id)
    }

    #[must_use]
    pub fn history_run_dir(&self, id: &str) -> PathBuf {
        self.history_root.join(id)
    }

    #[must_use]
    pub fn run_dir(&self, id: &str) -> PathBuf {
        let active = self.active_run_dir(id);
        if active.exists() {
            return active;
        }
        let history = self.history_run_dir(id);
        if history.exists() {
            return history;
        }
        let legacy = self.legacy_root.join(id);
        if legacy.exists() {
            return legacy;
        }
        active
    }

    pub fn create(&self, run: &Run) -> Result<(), StateError> {
        let run_dir = self.active_run_dir(&run.id);
        fs::create_dir_all(run_dir.join("actions"))?;
        fs::create_dir_all(run_dir.join("artifacts"))?;
        fs::create_dir_all(run_dir.join("context"))?;
        self.save(run)
    }

    pub fn save(&self, run: &Run) -> Result<(), StateError> {
        let history = self.history_run_dir(&run.id);
        let directory = if history.exists() {
            history
        } else {
            self.active_run_dir(&run.id)
        };
        atomic_json(&directory.join("run.json"), run)
    }

    pub fn load(&self, id: &str) -> Result<Run, StateError> {
        let path = self.run_dir(id).join("run.json");
        if !path.exists() {
            return Err(StateError::RunNotFound(id.to_string()));
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub fn archive(&self, id: &str) -> Result<PathBuf, StateError> {
        let active = self.active_run_dir(id);
        let history = self.history_run_dir(id);
        if history.exists() {
            return Err(StateError::AlreadyArchived(id.to_string()));
        }
        if !active.exists() {
            return Err(StateError::RunNotFound(id.to_string()));
        }
        fs::create_dir_all(&self.history_root)?;
        fs::rename(active, &history)?;
        Ok(history)
    }

    pub fn list_runs(&self) -> Result<Vec<String>, StateError> {
        let mut seen = HashSet::new();
        let mut runs = Vec::new();
        for root in [&self.active_root, &self.history_root, &self.legacy_root] {
            if !root.exists() {
                continue;
            }
            for entry in fs::read_dir(root)?.filter_map(Result::ok) {
                if !entry.path().is_dir() {
                    continue;
                }
                if let Ok(id) = entry.file_name().into_string() {
                    if seen.insert(id.clone()) {
                        runs.push(id);
                    }
                }
            }
        }
        runs.sort();
        Ok(runs)
    }

    pub fn latest_run_id(&self) -> Result<Option<String>, StateError> {
        let mut newest: Option<(std::time::SystemTime, String)> = None;
        for id in self.list_runs()? {
            let path = self.run_dir(&id).join("run.json");
            if !path.exists() {
                continue;
            }
            let modified = fs::metadata(path)?.modified()?;
            if newest
                .as_ref()
                .is_none_or(|(existing, _)| modified > *existing)
            {
                newest = Some((modified, id));
            }
        }
        Ok(newest.map(|(_, id)| id))
    }

    pub fn append_event(
        &self,
        run_id: &str,
        kind: EventKind,
        data: Value,
    ) -> Result<RunEvent, StateError> {
        let path = self.run_dir(run_id).join("events.jsonl");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let sequence = self
            .read_events(run_id)?
            .last()
            .map_or(1, |event| event.sequence + 1);
        let event = RunEvent {
            sequence,
            timestamp: Utc::now(),
            kind,
            data,
        };
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        serde_json::to_writer(&mut file, &event)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(event)
    }

    pub fn read_events(&self, run_id: &str) -> Result<Vec<RunEvent>, StateError> {
        let path = self.run_dir(run_id).join("events.jsonl");
        if !path.exists() {
            return Ok(Vec::new());
        }
        let mut events = Vec::new();
        for line in BufReader::new(fs::File::open(path)?).lines() {
            let line = line?;
            if !line.trim().is_empty() {
                events.push(serde_json::from_str(&line)?);
            }
        }
        Ok(events)
    }

}

pub(crate) fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), StateError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temporary)?;
        serde_json::to_writer_pretty(&mut file, value)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&temporary, path)?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
