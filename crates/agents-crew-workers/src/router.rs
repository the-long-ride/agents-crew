use crate::{Worker, WorkerError};
use agents_crew_core::{Capability, ModelFallback, Task, WorkspaceMode};
use std::{collections::BTreeSet, sync::Arc};

#[derive(Debug, Clone)]
pub struct RoutingContext {
    pub workspace_mode: WorkspaceMode,
    pub required_model: Option<String>,
    pub model_fallback: ModelFallback,
    pub remaining_budget: Option<u64>,
}

#[derive(Default)]
pub struct WorkerRouter {
    workers: Vec<Arc<dyn Worker>>,
}

impl WorkerRouter {
    #[must_use]
    pub fn new(workers: Vec<Arc<dyn Worker>>) -> Self {
        Self { workers }
    }

    #[must_use]
    pub fn workers(&self) -> &[Arc<dyn Worker>] {
        &self.workers
    }

    pub async fn select(
        &self,
        task: &Task,
        context: &RoutingContext,
    ) -> Result<Arc<dyn Worker>, WorkerError> {
        let mut eligible = Vec::new();
        for worker in &self.workers {
            let descriptor = worker.descriptor();
            if !descriptor.enabled
                || !descriptor.roles.contains(&task.role)
                || !task.capabilities.is_subset(&descriptor.capabilities)
            {
                continue;
            }
            if descriptor.transport == crate::WorkerTransport::Api
                && task.capabilities.contains(&Capability::Write)
            {
                continue;
            }
            if !task.preferred_workers.is_empty()
                && !task.preferred_workers.contains(&descriptor.id)
            {
                continue;
            }

            let probe = worker.probe().await?;
            if !probe.available {
                continue;
            }
            if let Some(model) = &context.required_model {
                if !descriptor.supports_model_selection
                    && context.model_fallback == ModelFallback::Deny
                {
                    return Err(WorkerError::ExactModelUnsupported {
                        worker: descriptor.id.clone(),
                        model: model.clone(),
                    });
                }
            }
            eligible.push(worker.clone());
        }

        eligible.sort_by(|left, right| {
            right
                .descriptor()
                .priority
                .cmp(&left.descriptor().priority)
                .then_with(|| left.descriptor().id.cmp(&right.descriptor().id))
        });
        eligible
            .into_iter()
            .next()
            .ok_or_else(|| WorkerError::NoEligibleWorker(task.id.clone()))
    }
}

#[must_use]
pub fn capability_set(values: &[Capability]) -> BTreeSet<Capability> {
    values.iter().copied().collect()
}
