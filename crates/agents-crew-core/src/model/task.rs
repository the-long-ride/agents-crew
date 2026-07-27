use super::{Capability, Evidence, Role, TestResult, TaskStatus, WorkerResultStatus};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkerResult {
    pub task_id: String,
    pub status: WorkerResultStatus,
    pub summary: String,
    #[serde(default)]
    pub artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub files_changed: Vec<PathBuf>,
    #[serde(default)]
    pub commands_run: Vec<Vec<String>>,
    #[serde(default)]
    pub capabilities_used: BTreeSet<Capability>,
    #[serde(default)]
    pub tests: Vec<TestResult>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub assumptions: Vec<String>,
    #[serde(default)]
    pub blockers: Vec<String>,
    #[serde(default)]
    pub recommended_next_tasks: Vec<TaskDraft>,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskDraft {
    pub title: String,
    pub instructions: String,
    pub role: Role,
    #[serde(default)]
    pub capabilities: BTreeSet<Capability>,
    #[serde(default)]
    pub write_scope: Vec<PathBuf>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub preferred_workers: Vec<String>,
    pub expected_output: String,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
}

const fn default_max_attempts() -> u32 {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Task {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub instructions: String,
    pub role: Role,
    #[serde(default)]
    pub capabilities: BTreeSet<Capability>,
    #[serde(default)]
    pub write_scope: Vec<PathBuf>,
    #[serde(default)]
    pub inputs: Vec<PathBuf>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub preferred_workers: Vec<String>,
    pub status: TaskStatus,
    pub attempt: u32,
    pub max_attempts: u32,
    pub assigned_worker: Option<String>,
    pub workspace_binding: Option<PathBuf>,
    pub expected_output: String,
    pub result: Option<WorkerResult>,
    pub strategy_fingerprint: Option<String>,
}

impl Task {
    #[must_use]
    pub fn from_draft(id: impl Into<String>, draft: TaskDraft) -> Self {
        Self {
            id: id.into(),
            parent_id: None,
            title: draft.title,
            instructions: draft.instructions,
            role: draft.role,
            capabilities: draft.capabilities,
            write_scope: draft.write_scope,
            inputs: Vec::new(),
            dependencies: draft.dependencies,
            preferred_workers: draft.preferred_workers,
            status: TaskStatus::Pending,
            attempt: 0,
            max_attempts: draft.max_attempts,
            assigned_worker: None,
            workspace_binding: None,
            expected_output: draft.expected_output,
            result: None,
            strategy_fingerprint: None,
        }
    }

    #[must_use]
    pub fn writes(&self) -> bool {
        self.capabilities.contains(&Capability::Write) || !self.write_scope.is_empty()
    }
}
