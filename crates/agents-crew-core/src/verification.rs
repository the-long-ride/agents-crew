use crate::{CoreError, Run, Task, TestStatus, WorkerResult, WorkerResultStatus};

pub fn verify_task_result(task: &Task, result: &WorkerResult) -> Result<(), CoreError> {
    if result.task_id != task.id {
        return Err(CoreError::VerificationFailed(
            "worker result task_id mismatch".into(),
        ));
    }
    if result.status != WorkerResultStatus::Completed {
        return Err(CoreError::VerificationFailed(result.summary.clone()));
    }
    if !result.capabilities_used.is_subset(&task.capabilities) {
        return Err(CoreError::VerificationFailed(
            "worker used capabilities outside the task envelope".into(),
        ));
    }
    if result
        .tests
        .iter()
        .any(|test| test.status == TestStatus::Failed)
    {
        return Err(CoreError::VerificationFailed(
            "worker reported failed test".into(),
        ));
    }
    Ok(())
}

pub fn verify_completion(run: &Run) -> Result<(), CoreError> {
    for criterion in &run.acceptance_criteria {
        if !run
            .evidence
            .iter()
            .any(|evidence| evidence.criterion_id == criterion.id && evidence.passed)
        {
            return Err(CoreError::MissingCriterionEvidence(criterion.id.clone()));
        }
    }
    if run
        .verification
        .iter()
        .any(|test| matches!(test.status, TestStatus::Failed | TestStatus::Blocked))
    {
        return Err(CoreError::VerificationFailed(
            "required verification did not pass".into(),
        ));
    }
    if run.tasks.values().any(|task| {
        !matches!(
            task.status,
            crate::TaskStatus::Completed | crate::TaskStatus::Cancelled
        )
    }) {
        return Err(CoreError::VerificationFailed(
            "not all active tasks completed".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ManagerCoding, ManagerIdentity, TaskStatus, WorkspaceMode};
    use std::path::PathBuf;

    #[test]
    fn cancelled_superseded_tasks_do_not_block_completion() {
        let mut run = Run::new(
            "goal",
            PathBuf::from("."),
            WorkspaceMode::Current,
            ManagerIdentity {
                host: "test".to_string(),
                coding: ManagerCoding::Never,
                small_fix_max_files: 0,
                small_fix_max_changed_lines: 0,
            },
            2,
        );
        run.acceptance_criteria.push(crate::AcceptanceCriterion {
            id: "goal".to_string(),
            description: "done".to_string(),
            required_checks: Vec::new(),
        });
        run.evidence.push(crate::Evidence {
            criterion_id: "goal".to_string(),
            source: "reviewer".to_string(),
            summary: "verified".to_string(),
            passed: true,
            artifact: None,
        });
        let mut task = crate::Task::from_draft(
            "old",
            crate::TaskDraft {
                title: "old".to_string(),
                instructions: "superseded".to_string(),
                role: crate::Role::Implementer,
                capabilities: Default::default(),
                write_scope: Vec::new(),
                dependencies: Vec::new(),
                preferred_workers: Vec::new(),
                expected_output: "none".to_string(),
                max_attempts: 1,
            },
        );
        task.status = TaskStatus::Cancelled;
        run.tasks.insert(task.id.clone(), task);
        assert!(verify_completion(&run).is_ok());
    }
}
