use crate::{
    verify_completion, verify_task_result, ApprovalStatus, CoreError, ManagerDecision, Run,
    RunStatus, TaskGraph, TaskStatus, WorkerResult,
};
use chrono::Utc;
use std::collections::BTreeSet;
use std::path::PathBuf;

pub fn create_run(
    goal: String,
    repository: PathBuf,
    workspace_mode: crate::WorkspaceMode,
    manager: crate::ManagerIdentity,
    max_iterations: u32,
) -> Run {
    Run::new(goal, repository, workspace_mode, manager, max_iterations)
}

pub fn apply_manager_decision(
    run: &mut Run,
    decision: ManagerDecision,
) -> Result<(), CoreError> {
    if run.iteration >= run.max_iterations {
        run.status = RunStatus::Failed;
        return Err(CoreError::InvalidManagerDecision(
            "iteration limit exhausted".into(),
        ));
    }

    if !decision.acceptance_criteria.is_empty() {
        let mut ids = BTreeSet::new();
        for criterion in &decision.acceptance_criteria {
            if criterion.id.trim().is_empty() || criterion.description.trim().is_empty() {
                return Err(CoreError::InvalidManagerDecision(
                    "acceptance criteria require non-empty IDs and descriptions".into(),
                ));
            }
            if !ids.insert(criterion.id.clone()) {
                return Err(CoreError::InvalidManagerDecision(format!(
                    "duplicate acceptance criterion {}",
                    criterion.id
                )));
            }
        }
        run.acceptance_criteria = decision.acceptance_criteria;
    }
    if run.acceptance_criteria.is_empty() {
        return Err(CoreError::InvalidManagerDecision(
            "manager plan must define acceptance criteria".into(),
        ));
    }

    for id in decision.tasks_to_cancel {
        if let Some(task) = run.tasks.get_mut(&id) {
            task.status = TaskStatus::Cancelled;
        }
    }
    for task in decision.tasks_to_add {
        if task.id.trim().is_empty()
            || task.title.trim().is_empty()
            || task.instructions.trim().is_empty()
            || task.expected_output.trim().is_empty()
        {
            return Err(CoreError::InvalidManagerDecision(
                "manager tasks require ID, title, instructions, and expected output".into(),
            ));
        }
        if task.max_attempts == 0
            || !matches!(task.status, TaskStatus::Pending | TaskStatus::Ready)
            || task.attempt != 0
            || task.result.is_some()
            || task.assigned_worker.is_some()
            || task.workspace_binding.is_some()
            || task.strategy_fingerprint.is_some()
        {
            return Err(CoreError::InvalidManagerDecision(format!(
                "manager task {} contains runtime-owned state",
                task.id
            )));
        }
        if run.tasks.contains_key(&task.id) {
            return Err(CoreError::DuplicateTask(task.id));
        }
        run.tasks.insert(task.id.clone(), task);
    }
    if run.tasks.is_empty() && decision.should_continue {
        return Err(CoreError::InvalidManagerDecision(
            "continuing plan must add at least one task".into(),
        ));
    }

    for approval in &decision.approval_requests {
        if approval.status != ApprovalStatus::Pending || approval.decided_at.is_some() {
            return Err(CoreError::InvalidManagerDecision(
                "manager cannot pre-decide approval requests".into(),
            ));
        }
    }

    let graph = TaskGraph::new(run.tasks.values().cloned().collect())?;
    run.tasks = graph.into_tasks();
    run.approvals.extend(decision.approval_requests);
    run.iteration += 1;
    run.updated_at = Utc::now();

    if let Some(claim) = decision.completion_claim {
        verify_completion(run)?;
        run.status = RunStatus::Completed;
        run.terminal_summary = Some(claim.summary);
    } else if decision.should_continue {
        run.status = RunStatus::Working;
    } else {
        run.status = RunStatus::Blocked;
    }
    Ok(())
}

pub fn record_worker_result(run: &mut Run, result: WorkerResult) -> Result<(), CoreError> {
    let task = run
        .tasks
        .get_mut(&result.task_id)
        .ok_or_else(|| CoreError::TaskNotFound(result.task_id.clone()))?;
    verify_task_result(task, &result)?;
    task.result = Some(result.clone());
    task.status = TaskStatus::Completed;
    run.evidence.extend(result.evidence);
    run.updated_at = Utc::now();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AcceptanceCriterion, ApprovalRequest, Capability, ManagerCoding, ManagerIdentity,
        Role, Task, TaskDraft, WorkspaceMode,
    };

    fn run() -> Run {
        Run::new(
            "goal",
            PathBuf::from("."),
            WorkspaceMode::Current,
            ManagerIdentity {
                host: "test".into(),
                coding: ManagerCoding::Never,
                small_fix_max_files: 0,
                small_fix_max_changed_lines: 0,
            },
            3,
        )
    }

    fn task() -> Task {
        Task::from_draft(
            "task",
            TaskDraft {
                title: "Task".into(),
                instructions: "Do work".into(),
                role: Role::Researcher,
                capabilities: [Capability::Read].into(),
                write_scope: vec![],
                dependencies: vec![],
                preferred_workers: vec![],
                expected_output: "Evidence".into(),
                max_attempts: 2,
            },
        )
    }

    fn criterion() -> AcceptanceCriterion {
        AcceptanceCriterion {
            id: "goal".into(),
            description: "Goal passes".into(),
            required_checks: vec![],
        }
    }

    #[test]
    fn rejects_manager_task_with_runtime_owned_state() {
        let mut state = run();
        let mut injected = task();
        injected.status = TaskStatus::Completed;
        let decision = ManagerDecision {
            acceptance_criteria: vec![criterion()],
            tasks_to_add: vec![injected],
            tasks_to_cancel: vec![],
            review_decisions: vec![],
            approval_requests: vec![],
            should_continue: true,
            completion_claim: None,
        };
        assert!(matches!(
            apply_manager_decision(&mut state, decision),
            Err(CoreError::InvalidManagerDecision(_))
        ));
    }

    #[test]
    fn rejects_plan_without_acceptance_criteria() {
        let mut state = run();
        let decision = ManagerDecision {
            acceptance_criteria: vec![],
            tasks_to_add: vec![task()],
            tasks_to_cancel: vec![],
            review_decisions: vec![],
            approval_requests: vec![],
            should_continue: true,
            completion_claim: None,
        };
        assert!(matches!(
            apply_manager_decision(&mut state, decision),
            Err(CoreError::InvalidManagerDecision(_))
        ));
    }

    #[test]
    fn rejects_preapproved_manager_request() {
        let mut state = run();
        let decision = ManagerDecision {
            acceptance_criteria: vec![criterion()],
            tasks_to_add: vec![task()],
            tasks_to_cancel: vec![],
            review_decisions: vec![],
            approval_requests: vec![ApprovalRequest {
                id: "approval".into(),
                operation: "push".into(),
                reason: "ship".into(),
                status: ApprovalStatus::Approved,
                created_at: Utc::now(),
                decided_at: Some(Utc::now()),
            }],
            should_continue: true,
            completion_claim: None,
        };
        assert!(matches!(
            apply_manager_decision(&mut state, decision),
            Err(CoreError::InvalidManagerDecision(_))
        ));
    }
}
