mod common;
mod decision;
mod run;
mod task;

pub use common::*;
pub use decision::*;
pub use run::*;
pub use task::*;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("duplicate task id: {0}")]
    DuplicateTask(String),
    #[error("missing dependency {dependency} for task {task}")]
    MissingDependency { task: String, dependency: String },
    #[error("dependency cycle: {0:?}")]
    DependencyCycle(Vec<String>),
    #[error("task not found: {0}")]
    TaskNotFound(String),
    #[error("invalid task transition for {task}: {from:?} -> {to:?}")]
    InvalidTransition {
        task: String,
        from: TaskStatus,
        to: TaskStatus,
    },
    #[error("missing criterion evidence: {0}")]
    MissingCriterionEvidence(String),
    #[error("verification failed: {0}")]
    VerificationFailed(String),
    #[error("invalid manager decision: {0}")]
    InvalidManagerDecision(String),
}
