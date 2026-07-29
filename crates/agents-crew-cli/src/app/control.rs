use super::*;

pub(super) fn status(workspace: &Path, requested: Option<&str>) -> Result<Value> {
    let id = latest_id(workspace, requested)?;
    let run = store(workspace).load(&id)?;
    run_response(workspace, &run)
}

pub(super) fn run_response(workspace: &Path, run: &Run) -> Result<Value> {
    let run_store = store(workspace);
    let pending = run_store.pending_actions(&run.id)?;
    let expired = run_store.expired_actions(&run.id)?;
    Ok(json!({
        "run": run,
        "pending_actions": pending,
        "expired_actions": expired
    }))
}

pub(super) async fn resume(workspace: &Path, requested: Option<&str>) -> Result<Value> {
    let id = latest_id(workspace, requested)?;
    let cfg = run_config(workspace, &id)?;
    let mut run = store(workspace).load(&id)?;
    if matches!(run.status, RunStatus::Completed | RunStatus::Cancelled) {
        return Err(anyhow!(
            "run {id} is terminal ({:?}) and can only be inspected",
            run.status
        ));
    }
    if run.status == RunStatus::Failed {
        create_failed_run_recovery(workspace, &mut run)?;
        persist_run(workspace, &run)?;
        return run_response(workspace, &run);
    }
    if recover_interrupted_tasks(workspace, &mut run)? {
        persist_run(workspace, &run)?;
        return run_response(workspace, &run);
    }
    if matches!(run.status, RunStatus::Paused | RunStatus::Blocked) {
        run.status = RunStatus::Working;
        store(workspace).append_event(&id, EventKind::RunResumed, json!({}))?;
    }
    if !matches!(
        run.status,
        RunStatus::ManagerRequired | RunStatus::AwaitingApproval
    ) {
        advance_run(workspace, &cfg, &mut run).await?;
    }
    persist_run(workspace, &run)?;
    run_response(workspace, &run)
}

fn create_failed_run_recovery(workspace: &Path, run: &mut Run) -> Result<()> {
    let run_store = store(workspace);
    if !run_store.pending_actions(&run.id)?.is_empty() {
        run.status = RunStatus::ManagerRequired;
        return Ok(());
    }
    let task_id = run
        .tasks
        .values()
        .find(|task| matches!(task.status, TaskStatus::Failed | TaskStatus::Blocked))
        .map_or_else(|| "run-recovery".to_string(), |task| task.id.clone());
    let action = OutstandingAction {
        id: Uuid::new_v4().to_string(),
        run_id: run.id.clone(),
        task_id: Some(task_id.clone()),
        issued_at: Utc::now(),
        expires_at: Some(Utc::now() + Duration::hours(24)),
        capability_envelope: BTreeSet::new(),
        action: ManagerAction::Review {
            task_id: task_id.clone(),
            state_path: run_store.run_dir(&run.id).join("run.json"),
            output_schema: workspace.join("schemas/manager-decision.schema.json"),
        },
        consumed: false,
    };
    run_store.save_action(&action)?;
    run_store.append_event(
        &run.id,
        EventKind::ManagerActionIssued,
        json!({ "action_id": action.id, "type": "failed_run_recovery", "task_id": task_id }),
    )?;
    run.status = RunStatus::ManagerRequired;
    run.terminal_summary = Some(
        "Failed run reopened for manager recovery review using durable context".to_string(),
    );
    Ok(())
}

pub(super) fn recover_interrupted_tasks(workspace: &Path, run: &mut Run) -> Result<bool> {
    let interrupted = run
        .tasks
        .values()
        .filter(|task| matches!(task.status, TaskStatus::Running | TaskStatus::Verifying))
        .map(|task| task.id.clone())
        .collect::<Vec<_>>();
    if interrupted.is_empty() {
        return Ok(false);
    }

    let run_store = store(workspace);
    let pending_task_ids = run_store
        .pending_actions(&run.id)?
        .into_iter()
        .filter_map(|action| action.task_id)
        .collect::<BTreeSet<_>>();
    for task_id in &interrupted {
        if let Some(task) = run.tasks.get_mut(task_id) {
            task.status = TaskStatus::Blocked;
        }
        if pending_task_ids.contains(task_id) {
            continue;
        }
        let action = OutstandingAction {
            id: Uuid::new_v4().to_string(),
            run_id: run.id.clone(),
            task_id: Some(task_id.clone()),
            issued_at: Utc::now(),
            expires_at: Some(Utc::now() + Duration::hours(24)),
            capability_envelope: BTreeSet::new(),
            action: ManagerAction::Review {
                task_id: task_id.clone(),
                state_path: run_store.run_dir(&run.id).join("run.json"),
                output_schema: workspace.join("schemas/manager-decision.schema.json"),
            },
            consumed: false,
        };
        run_store.save_action(&action)?;
        run_store.append_event(
            &run.id,
            EventKind::ManagerActionIssued,
            json!({ "action_id": action.id, "type": "recovery_review", "task_id": task_id }),
        )?;
    }
    run.status = RunStatus::ManagerRequired;
    run.terminal_summary = Some(format!(
        "Interrupted task state detected for {}; inspect repository/worktrees before replanning",
        interrupted.join(", ")
    ));
    Ok(true)
}

pub(super) fn set_run_status(
    workspace: &Path,
    requested: Option<&str>,
    next: RunStatus,
    label: &str,
) -> Result<Value> {
    let id = latest_id(workspace, requested)?;
    let mut run = store(workspace).load(&id)?;
    run.status = next;
    run.updated_at = Utc::now();
    let event = match next {
        RunStatus::Paused => Some(EventKind::RunPaused),
        RunStatus::Cancelled => Some(EventKind::RunCancelled),
        _ => None,
    };
    if let Some(kind) = event {
        store(workspace).append_event(&id, kind, json!({ "status": label }))?;
    }
    persist_run(workspace, &run)?;
    Ok(json!({ "run_id": id, "status": label }))
}

pub(super) fn decide_approval(
    workspace: &Path,
    requested: Option<&str>,
    approval_id: &str,
    approve: bool,
) -> Result<Value> {
    let id = latest_id(workspace, requested)?;
    let mut run = store(workspace).load(&id)?;
    let approval = run
        .approvals
        .iter_mut()
        .find(|approval| approval.id == approval_id)
        .ok_or_else(|| anyhow!("approval not found"))?;
    approval.status = if approve {
        ApprovalStatus::Approved
    } else {
        ApprovalStatus::Rejected
    };
    approval.decided_at = Some(Utc::now());
    let operation = approval.operation.clone();
    run.status = if approve {
        for task in run.tasks.values_mut() {
            if operation.starts_with(&format!("task:{}:", task.id))
                && task.status == TaskStatus::Blocked
            {
                task.status = TaskStatus::Retryable;
            }
        }
        RunStatus::Working
    } else {
        RunStatus::Blocked
    };
    persist_run(workspace, &run)?;
    store(workspace).append_event(
        &id,
        EventKind::ApprovalDecided,
        json!({ "approval_id": approval_id, "approved": approve }),
    )?;
    Ok(json!({
        "run_id": id,
        "approval_id": approval_id,
        "approved": approve
    }))
}
