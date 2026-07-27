use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunEvent {
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub kind: EventKind,
    pub data: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    RunStarted,
    ManagerActionIssued,
    ManagerActionSubmitted,
    TaskAdded,
    TaskStarted,
    TaskCompleted,
    TaskFailed,
    ApprovalRequested,
    ApprovalDecided,
    RunPaused,
    RunResumed,
    RunCompleted,
    RunFailed,
    RunCancelled,
}
