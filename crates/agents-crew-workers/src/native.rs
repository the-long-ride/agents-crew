use crate::{WorkerError, WorkerRequest};
use agents_crew_core::{Capability, ManagerAction, WorkerResult};
use agents_crew_state::{OutstandingAction, RunStore};
use chrono::{Duration, Utc};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Clone)]
pub struct NativeBridge {
    store: RunStore,
}

impl NativeBridge {
    #[must_use]
    pub fn new(store: RunStore) -> Self {
        Self { store }
    }

    pub fn issue(&self, request: &WorkerRequest) -> Result<OutstandingAction, WorkerError> {
        let action = OutstandingAction {
            id: Uuid::new_v4().to_string(),
            run_id: request.run_id.clone(),
            task_id: Some(request.task.id.clone()),
            issued_at: Utc::now(),
            expires_at: Some(Utc::now() + Duration::hours(24)),
            capability_envelope: request.task.capabilities.clone(),
            action: ManagerAction::DispatchNative {
                task_id: request.task.id.clone(),
                role: request.task.role,
                model: request.model.clone(),
                model_fallback: request.model_fallback,
                capabilities: request.task.capabilities.clone(),
                workspace: request.workspace.clone(),
                context_path: request.context_path.clone(),
                output_schema: request.workspace.join("schemas/worker-result.schema.json"),
            },
            consumed: false,
        };
        self.store.save_action(&action)?;
        Ok(action)
    }

    pub fn submit(
        &self,
        run_id: &str,
        action_id: &str,
        result: WorkerResult,
        claimed: &BTreeSet<Capability>,
    ) -> Result<WorkerResult, WorkerError> {
        let action = self.store.consume_action(run_id, action_id, claimed)?;
        if action.task_id.as_deref() != Some(result.task_id.as_str()) {
            return Err(WorkerError::InvalidResult(
                "native result task mismatch".into(),
            ));
        }
        Ok(result)
    }

    pub fn pending(&self, run_id: &str) -> Result<Vec<OutstandingAction>, WorkerError> {
        Ok(self.store.pending_actions(run_id)?)
    }
}
