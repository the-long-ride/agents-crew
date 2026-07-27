use super::*;

pub(super) fn handle_execution(
    workspace: &Path,
    cfg: &CrewConfig,
    run: &mut Run,
    execution: Execution,
) -> Result<()> {
    match execution {
        Execution::Result {
            result,
            workspace: binding,
            patch,
            worker_id,
            fingerprint,
        } => {
            let task_id = result.task_id.clone();
            if let Some(task) = run.tasks.get_mut(&task_id) {
                task.workspace_binding = binding.clone();
                task.assigned_worker = Some(worker_id);
                task.strategy_fingerprint = Some(fingerprint);
                task.status = TaskStatus::Verifying;
            }
            let precheck = run
                .tasks
                .get(&task_id)
                .ok_or_else(|| anyhow!("missing task {task_id}"))
                .and_then(|task| verify_task_result(task, &result).map_err(Into::into));
            if let Err(error) = precheck {
                cleanup_failed_binding(workspace, cfg, binding.as_deref());
                let message = if binding.is_none() && !result.files_changed.is_empty() {
                    format!(
                        "worker returned an invalid result after modifying files: {:?}; {error}",
                        result.files_changed
                    )
                } else {
                    error.to_string()
                };
                return mark_task_failure(workspace, run, &task_id, &message);
            }
            if let Some(patch_path) = patch {
                if let Err(error) = GitRepository::discover(workspace)
                    .and_then(|repository| repository.apply_patch(&patch_path))
                {
                    cleanup_failed_binding(workspace, cfg, binding.as_deref());
                    return mark_task_failure(workspace, run, &task_id, &error.to_string());
                }
            }
            match record_worker_result(run, result.clone()) {
                Ok(()) => {
                    if let Some(path) = binding.as_deref() {
                        let _ = GitRepository::discover(workspace)
                            .and_then(|repository| repository.cleanup_task_worktree(path));
                    }
                    store(workspace).append_event(
                        &run.id,
                        EventKind::TaskCompleted,
                        json!({ "task_id": result.task_id }),
                    )?;
                }
                Err(error) => {
                    cleanup_failed_binding(workspace, cfg, binding.as_deref());
                    mark_task_failure(workspace, run, &task_id, &error.to_string())?;
                }
            }
        }
        Execution::Native {
            action,
            workspace: binding,
            worker_id,
            fingerprint,
        } => {
            if let Some(task_id) = action.task_id.as_ref() {
                if let Some(task) = run.tasks.get_mut(task_id) {
                    task.status = TaskStatus::Blocked;
                    task.workspace_binding = binding;
                    task.assigned_worker = Some(worker_id);
                    task.strategy_fingerprint = Some(fingerprint);
                }
            }
            run.status = RunStatus::ManagerRequired;
            store(workspace).append_event(
                &run.id,
                EventKind::ManagerActionIssued,
                json!({ "action_id": action.id, "type": "dispatch_native" }),
            )?;
        }
        Execution::Approval(approval) => {
            let task_id = approval
                .operation
                .strip_prefix("task:")
                .and_then(|rest| rest.split(':').next())
                .map(str::to_string);
            if !run.approvals.iter().any(|item| item.id == approval.id) {
                run.approvals.push(approval.clone());
            }
            if let Some(task_id) = task_id {
                if let Some(task) = run.tasks.get_mut(&task_id) {
                    task.status = TaskStatus::Blocked;
                }
            }
            run.status = RunStatus::AwaitingApproval;
            store(workspace).append_event(
                &run.id,
                EventKind::ApprovalRequested,
                json!({
                    "approval_id": approval.id,
                    "operation": approval.operation,
                    "reason": approval.reason
                }),
            )?;
        }
        Execution::Failure {
            task_id,
            message,
            workspace: binding,
            worker_id,
            fingerprint,
        } => {
            if let Some(task) = run.tasks.get_mut(&task_id) {
                if let Some(worker_id) = worker_id {
                    task.assigned_worker = Some(worker_id);
                }
                if let Some(fingerprint) = fingerprint {
                    task.strategy_fingerprint = Some(fingerprint);
                }
                if cfg.run.retain_failed_worktrees {
                    task.workspace_binding = binding.clone();
                }
            }
            cleanup_failed_binding(workspace, cfg, binding.as_deref());
            mark_task_failure(workspace, run, &task_id, &message)?;
        }
    }
    Ok(())
}

pub(super) fn cleanup_failed_binding(workspace: &Path, cfg: &CrewConfig, binding: Option<&Path>) {
    if cfg.run.retain_failed_worktrees {
        return;
    }
    if let Some(path) = binding {
        let _ = GitRepository::discover(workspace)
            .and_then(|repository| repository.cleanup_task_worktree(path));
    }
}

pub(super) fn mark_task_failure(workspace: &Path, run: &mut Run, task_id: &str, message: &str) -> Result<()> {
    let repository_contaminated = (message.contains("read-only") && message.contains("modified files"))
        || message.contains("write outside scope")
        || message.contains("failed after modifying files")
        || message.contains("invalid result after modifying files");
    let retryable = {
        let task = run
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| anyhow!("missing task {task_id}"))?;
        task.attempt += 1;
        if task.attempt < task.max_attempts && !repository_contaminated {
            task.status = TaskStatus::Retryable;
            true
        } else {
            task.status = TaskStatus::Failed;
            false
        }
    };

    if retryable {
        let run_store = store(workspace);
        let action = OutstandingAction {
            id: Uuid::new_v4().to_string(),
            run_id: run.id.clone(),
            task_id: Some(task_id.to_string()),
            issued_at: Utc::now(),
            expires_at: Some(Utc::now() + Duration::hours(24)),
            capability_envelope: BTreeSet::new(),
            action: ManagerAction::Review {
                task_id: task_id.to_string(),
                state_path: run_store.run_dir(&run.id).join("run.json"),
                output_schema: workspace.join("schemas/manager-decision.schema.json"),
            },
            consumed: false,
        };
        run_store.save_action(&action)?;
        run_store.append_event(
            &run.id,
            EventKind::ManagerActionIssued,
            json!({ "action_id": action.id, "type": "review", "task_id": task_id }),
        )?;
        run.status = RunStatus::ManagerRequired;
    } else {
        run.status = RunStatus::Failed;
        run.terminal_summary = Some(format!("task {task_id} failed: {message}"));
    }
    store(workspace).append_event(
        &run.id,
        EventKind::TaskFailed,
        json!({ "task_id": task_id, "error": message }),
    )?;
    Ok(())
}
