use agents_crew_core::{Capability, ModelFallback, Role, Task, WorkerResult, WorkspaceMode};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("worker unavailable: {0}")]
    Unavailable(String),
    #[error("no eligible worker for task {0}")]
    NoEligibleWorker(String),
    #[error("exact model unsupported by worker {worker}: {model}")]
    ExactModelUnsupported { worker: String, model: String },
    #[error("execution failed: {0}")]
    Execution(String),
    #[error("invalid result: {0}")]
    InvalidResult(String),
    #[error(transparent)]
    State(#[from] agents_crew_state::StateError),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerDescriptor {
    pub id: String,
    pub transport: WorkerTransport,
    pub roles: BTreeSet<Role>,
    pub capabilities: BTreeSet<Capability>,
    pub priority: i32,
    pub enabled: bool,
    pub supports_model_selection: bool,
    pub configured_model: Option<String>,
    pub requires_network: bool,
    pub requires_credentials: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerTransport {
    Native,
    Cli,
    Api,
    Fake,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerProbe {
    pub available: bool,
    pub version: Option<String>,
    pub capabilities: BTreeSet<Capability>,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct WorkerRequest {
    pub run_id: String,
    pub task: Task,
    pub workspace: PathBuf,
    pub context_path: PathBuf,
    pub output_path: PathBuf,
    pub role_prompt: String,
    pub model: Option<String>,
    pub model_fallback: ModelFallback,
    pub timeout_seconds: u64,
    pub workspace_mode: WorkspaceMode,
}

#[async_trait]
pub trait Worker: Send + Sync {
    fn descriptor(&self) -> &WorkerDescriptor;

    async fn probe(&self) -> Result<WorkerProbe, WorkerError>;

    async fn execute(&self, request: WorkerRequest) -> Result<WorkerResult, WorkerError>;

    async fn cancel(&self, _execution_id: &str) -> Result<(), WorkerError> {
        Ok(())
    }
}
