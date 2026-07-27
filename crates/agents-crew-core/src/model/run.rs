use super::{
    AcceptanceCriterion, ApprovalStatus, Evidence, ManagerCoding, RunStatus, Task, TestResult,
    WorkspaceMode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerIdentity {
    pub host: String,
    pub coding: ManagerCoding,
    pub small_fix_max_files: usize,
    pub small_fix_max_changed_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApprovalRequest {
    pub id: String,
    pub operation: String,
    pub reason: String,
    pub status: ApprovalStatus,
    pub created_at: DateTime<Utc>,
    pub decided_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Run {
    pub id: String,
    pub original_goal: String,
    pub normalized_goal: String,
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
    pub repository: PathBuf,
    pub workspace_mode: WorkspaceMode,
    pub manager: ManagerIdentity,
    pub tasks: BTreeMap<String, Task>,
    pub approvals: Vec<ApprovalRequest>,
    pub evidence: Vec<Evidence>,
    pub verification: Vec<TestResult>,
    pub status: RunStatus,
    pub iteration: u32,
    pub max_iterations: u32,
    pub event_sequence: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub terminal_summary: Option<String>,
}

impl Run {
    #[must_use]
    pub fn new(
        goal: impl Into<String>,
        repository: PathBuf,
        workspace_mode: WorkspaceMode,
        manager: ManagerIdentity,
        max_iterations: u32,
    ) -> Self {
        let goal = goal.into();
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            original_goal: goal.clone(),
            normalized_goal: goal.trim().to_string(),
            acceptance_criteria: Vec::new(),
            repository,
            workspace_mode,
            manager,
            tasks: BTreeMap::new(),
            approvals: Vec::new(),
            evidence: Vec::new(),
            verification: Vec::new(),
            status: RunStatus::Planning,
            iteration: 0,
            max_iterations,
            event_sequence: 0,
            created_at: now,
            updated_at: now,
            terminal_summary: None,
        }
    }
}
