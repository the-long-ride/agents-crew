use crate::{Worker, WorkerDescriptor, WorkerError, WorkerProbe, WorkerRequest, WorkerTransport};
use agents_crew_core::{Evidence, WorkerResult, WorkerResultStatus};
use async_trait::async_trait;
use std::sync::Mutex;

pub struct FakeWorker {
    descriptor: WorkerDescriptor,
    results: Mutex<Vec<WorkerResult>>,
}

impl FakeWorker {
    #[must_use]
    pub fn new(descriptor: WorkerDescriptor, results: Vec<WorkerResult>) -> Self {
        Self {
            descriptor,
            results: Mutex::new(results),
        }
    }
}

#[async_trait]
impl Worker for FakeWorker {
    fn descriptor(&self) -> &WorkerDescriptor {
        &self.descriptor
    }

    async fn probe(&self) -> Result<WorkerProbe, WorkerError> {
        Ok(WorkerProbe {
            available: true,
            version: Some("fake-1".into()),
            capabilities: self.descriptor.capabilities.clone(),
            message: "deterministic fake".into(),
        })
    }

    async fn execute(&self, request: WorkerRequest) -> Result<WorkerResult, WorkerError> {
        let queued_result = self
            .results
            .lock()
            .map_err(|_| WorkerError::Execution("fake lock poisoned".into()))?
            .pop();
        if let Some(mut result) = queued_result {
            result.task_id = request.task.id;
            return Ok(result);
        }

        Ok(WorkerResult {
            task_id: request.task.id,
            status: WorkerResultStatus::Completed,
            summary: "fake completed".into(),
            artifacts: vec![],
            files_changed: vec![],
            commands_run: vec![],
            capabilities_used: request.task.capabilities.clone(),
            tests: vec![],
            evidence: vec![Evidence {
                criterion_id: "goal".into(),
                source: self.descriptor.id.clone(),
                summary: "fake evidence".into(),
                passed: true,
                artifact: None,
            }],
            assumptions: vec![],
            blockers: vec![],
            recommended_next_tasks: vec![],
            metadata: Default::default(),
        })
    }
}

#[must_use]
pub fn fake_descriptor(id: &str) -> WorkerDescriptor {
    WorkerDescriptor {
        id: id.into(),
        transport: WorkerTransport::Fake,
        roles: [
            agents_crew_core::Role::Planner,
            agents_crew_core::Role::Researcher,
            agents_crew_core::Role::Implementer,
            agents_crew_core::Role::Tester,
            agents_crew_core::Role::Reviewer,
        ]
        .into(),
        capabilities: [
            agents_crew_core::Capability::Read,
            agents_crew_core::Capability::Write,
            agents_crew_core::Capability::Shell,
        ]
        .into(),
        priority: 50,
        enabled: true,
        supports_model_selection: true,
        configured_model: None,
        requires_network: false,
        requires_credentials: false,
    }
}
