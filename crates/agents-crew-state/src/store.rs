use crate::{EventKind, RunEvent};
use agents_crew_core::{Capability, ManagerAction, Run};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
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
    root: PathBuf,
}

impl RunStore {
    #[must_use]
    pub fn new(workspace: &Path) -> Self {
        Self {
            root: workspace.join(".agents-crew/runs"),
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn run_dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    pub fn create(&self, run: &Run) -> Result<(), StateError> {
        fs::create_dir_all(self.run_dir(&run.id).join("actions"))?;
        fs::create_dir_all(self.run_dir(&run.id).join("artifacts"))?;
        fs::create_dir_all(self.run_dir(&run.id).join("context"))?;
        self.save(run)
    }

    pub fn save(&self, run: &Run) -> Result<(), StateError> {
        atomic_json(&self.run_dir(&run.id).join("run.json"), run)
    }

    pub fn load(&self, id: &str) -> Result<Run, StateError> {
        let path = self.run_dir(id).join("run.json");
        if !path.exists() {
            return Err(StateError::RunNotFound(id.to_string()));
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub fn list_runs(&self) -> Result<Vec<String>, StateError> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut runs = fs::read_dir(&self.root)?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect::<Vec<_>>();
        runs.sort();
        Ok(runs)
    }

    pub fn latest_run_id(&self) -> Result<Option<String>, StateError> {
        let mut newest: Option<(std::time::SystemTime, String)> = None;
        for id in self.list_runs()? {
            let modified = fs::metadata(self.run_dir(&id).join("run.json"))?.modified()?;
            if newest
                .as_ref()
                .map_or(true, |(existing, _)| modified > *existing)
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

    pub fn save_action(&self, action: &OutstandingAction) -> Result<(), StateError> {
        atomic_json(
            &self
                .run_dir(&action.run_id)
                .join("actions")
                .join(format!("{}.json", action.id)),
            action,
        )
    }

    pub fn load_action(
        &self,
        run_id: &str,
        id: &str,
    ) -> Result<OutstandingAction, StateError> {
        let path = self
            .run_dir(run_id)
            .join("actions")
            .join(format!("{id}.json"));
        if !path.exists() {
            return Err(StateError::UnknownAction(id.to_string()));
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub fn consume_action(
        &self,
        run_id: &str,
        id: &str,
        claimed: &BTreeSet<Capability>,
    ) -> Result<OutstandingAction, StateError> {
        let mut action = self.load_action(run_id, id)?;
        if action.consumed {
            return Err(StateError::ActionConsumed(id.to_string()));
        }
        if action.expires_at.is_some_and(|expires| expires <= Utc::now()) {
            return Err(StateError::ActionExpired(id.to_string()));
        }
        if !claimed.is_subset(&action.capability_envelope) {
            return Err(StateError::CapabilityMismatch);
        }
        action.consumed = true;
        self.save_action(&action)?;
        Ok(action)
    }

    pub fn expired_actions(&self, run_id: &str) -> Result<Vec<OutstandingAction>, StateError> {
        let directory = self.run_dir(run_id).join("actions");
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut actions = Vec::new();
        for entry in fs::read_dir(directory)?.filter_map(Result::ok) {
            let action: OutstandingAction = serde_json::from_slice(&fs::read(entry.path())?)?;
            if !action.consumed
                && action
                    .expires_at
                    .is_some_and(|expires| expires <= Utc::now())
            {
                actions.push(action);
            }
        }
        actions.sort_by_key(|action| action.issued_at);
        Ok(actions)
    }

    pub fn pending_actions(&self, run_id: &str) -> Result<Vec<OutstandingAction>, StateError> {
        let directory = self.run_dir(run_id).join("actions");
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut actions = Vec::new();
        for entry in fs::read_dir(directory)?.filter_map(Result::ok) {
            let action: OutstandingAction =
                serde_json::from_slice(&fs::read(entry.path())?)?;
            if !action.consumed
                && action
                    .expires_at
                    .map_or(true, |expires| expires > Utc::now())
            {
                actions.push(action);
            }
        }
        actions.sort_by_key(|action| action.issued_at);
        Ok(actions)
    }
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), StateError> {
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
mod tests {
    use super::*;
    use agents_crew_core::{ManagerCoding, ManagerIdentity, WorkspaceMode};
    use tempfile::tempdir;

    #[test]
    fn events_are_monotonic() {
        let directory = tempdir().unwrap();
        let store = RunStore::new(directory.path());
        let run = Run::new(
            "x",
            directory.path().into(),
            WorkspaceMode::Current,
            ManagerIdentity {
                host: "x".to_string(),
                coding: ManagerCoding::Never,
                small_fix_max_files: 0,
                small_fix_max_changed_lines: 0,
            },
            2,
        );
        let id = run.id.clone();
        store.create(&run).unwrap();
        store
            .append_event(&id, EventKind::RunStarted, Value::Null)
            .unwrap();
        store
            .append_event(&id, EventKind::TaskAdded, Value::Null)
            .unwrap();
        assert_eq!(store.read_events(&id).unwrap()[1].sequence, 2);
    }
}
