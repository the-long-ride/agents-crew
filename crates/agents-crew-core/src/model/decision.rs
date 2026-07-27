use super::{
    AcceptanceCriterion, ApprovalRequest, Capability, ModelFallback, Role, RunStatus, Task,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewDecision {
    pub task_id: String,
    pub approved: bool,
    pub findings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CompletionClaim {
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManagerDecision {
    #[serde(default)]
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
    #[serde(default)]
    pub tasks_to_add: Vec<Task>,
    #[serde(default)]
    pub tasks_to_cancel: Vec<String>,
    #[serde(default)]
    pub review_decisions: Vec<ReviewDecision>,
    #[serde(default)]
    pub approval_requests: Vec<ApprovalRequest>,
    pub should_continue: bool,
    pub completion_claim: Option<CompletionClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ManagerAction {
    Plan {
        goal: String,
        state_path: PathBuf,
        output_schema: PathBuf,
    },
    Review {
        task_id: String,
        state_path: PathBuf,
        output_schema: PathBuf,
    },
    DispatchNative {
        task_id: String,
        role: Role,
        model: Option<String>,
        model_fallback: ModelFallback,
        capabilities: BTreeSet<Capability>,
        workspace: PathBuf,
        context_path: PathBuf,
        output_schema: PathBuf,
    },
    RequestApproval {
        approval_id: String,
        operation: String,
        reason: String,
    },
    Display {
        message: String,
    },
    Terminal {
        status: RunStatus,
        summary: String,
    },
}
