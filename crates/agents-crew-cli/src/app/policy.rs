use super::*;

pub(super) fn enforce_manager_coding(run: &Run, task: &Task) -> Result<()> {
    if !task.writes() || task.role != Role::Manager {
        return Ok(());
    }
    match run.manager.coding {
        ManagerCoding::Never => Err(anyhow!(
            "manager coding is disabled; no non-native writer was available"
        )),
        ManagerCoding::Full => Ok(()),
        ManagerCoding::SmallFixes => {
            let scoped_files = task
                .write_scope
                .iter()
                .filter(|scope| scope.as_path() != Path::new("."))
                .count();
            if task.write_scope.iter().any(|scope| scope == Path::new("."))
                || scoped_files > run.manager.small_fix_max_files
            {
                Err(anyhow!(
                    "task exceeds manager small-fix file scope; configure a writer worker or manager.coding=full"
                ))
            } else {
                Ok(())
            }
        }
    }
}

pub(super) fn enforce_task_policy(cfg: &CrewConfig, run: &Run, task: &Task) -> Result<Option<Execution>> {
    for capability in &task.capabilities {
        let operation = match capability {
            Capability::Network => Some(Operation::Network),
            Capability::Commit => Some(Operation::Commit),
            Capability::Push => Some(Operation::Push),
            Capability::Deploy => Some(Operation::Deploy),
            Capability::Destructive => Some(Operation::DestructiveCommand),
            Capability::Read => Some(Operation::LocalRead),
            Capability::Write => Some(Operation::LocalEdit),
            Capability::Shell => None,
        };
        let Some(operation) = operation else {
            continue;
        };
        if let Some(execution) = enforce_operation(
            cfg,
            run,
            task,
            operation,
            format!("Task {} requires guarded capability {:?}", task.id, capability),
        )? {
            return Ok(Some(execution));
        }
    }
    Ok(None)
}

pub(super) fn enforce_worker_transport_policy(
    cfg: &CrewConfig,
    run: &Run,
    task: &Task,
    worker: &agents_crew_workers::WorkerDescriptor,
) -> Result<Option<Execution>> {
    let mut guarded = Vec::new();
    if worker.requires_network {
        guarded.push((
            Operation::Network,
            format!(
                "Worker {} for task {} requires external network access",
                worker.id, task.id
            ),
        ));
    }
    if worker.requires_credentials {
        guarded.push((
            Operation::CredentialedAction,
            format!(
                "Worker {} for task {} requires credentials",
                worker.id, task.id
            ),
        ));
    }
    for (operation, reason) in guarded {
        if let Some(execution) = enforce_operation(cfg, run, task, operation, reason)? {
            return Ok(Some(execution));
        }
    }
    Ok(None)
}

pub(super) fn enforce_operation(
    cfg: &CrewConfig,
    run: &Run,
    task: &Task,
    operation: Operation,
    reason: String,
) -> Result<Option<Execution>> {
    let engine = PolicyEngine::new(cfg.permissions.clone());
    let context = PolicyContext {
        manager_coding: run.manager.coding,
        small_fix_max_files: run.manager.small_fix_max_files,
        small_fix_max_changed_lines: run.manager.small_fix_max_changed_lines,
    };
    let operation_key = format!("task:{}:{operation:?}", task.id).to_lowercase();
    if let Some(existing) = run
        .approvals
        .iter()
        .find(|approval| approval.operation == operation_key)
    {
        return match existing.status {
            ApprovalStatus::Approved => Ok(None),
            ApprovalStatus::Rejected => {
                Err(anyhow!("guarded operation was rejected: {operation_key}"))
            }
            ApprovalStatus::Pending => Ok(Some(Execution::Approval(existing.clone()))),
        };
    }
    match engine.decide(&operation, &context) {
        PolicyDecision::Allow => Ok(None),
        PolicyDecision::Deny => Err(anyhow!("policy denied operation: {operation_key}")),
        PolicyDecision::Ask => Ok(Some(Execution::Approval(ApprovalRequest {
            id: Uuid::new_v4().to_string(),
            operation: operation_key,
            reason,
            status: ApprovalStatus::Pending,
            created_at: Utc::now(),
            decided_at: None,
        }))),
    }
}

pub(super) fn enforce_run_operation(
    cfg: &CrewConfig,
    run: &Run,
    operation: Operation,
    reason: String,
) -> Result<Option<ApprovalRequest>> {
    let engine = PolicyEngine::new(cfg.permissions.clone());
    let context = PolicyContext {
        manager_coding: run.manager.coding,
        small_fix_max_files: run.manager.small_fix_max_files,
        small_fix_max_changed_lines: run.manager.small_fix_max_changed_lines,
    };
    let operation_key = format!("run:{operation:?}").to_lowercase();
    if let Some(existing) = run
        .approvals
        .iter()
        .find(|approval| approval.operation == operation_key)
    {
        return match existing.status {
            ApprovalStatus::Approved => Ok(None),
            ApprovalStatus::Rejected => {
                Err(anyhow!("guarded operation was rejected: {operation_key}"))
            }
            ApprovalStatus::Pending => Ok(Some(existing.clone())),
        };
    }
    match engine.decide(&operation, &context) {
        PolicyDecision::Allow => Ok(None),
        PolicyDecision::Deny => Err(anyhow!("policy denied operation: {operation_key}")),
        PolicyDecision::Ask => Ok(Some(ApprovalRequest {
            id: Uuid::new_v4().to_string(),
            operation: operation_key,
            reason,
            status: ApprovalStatus::Pending,
            created_at: Utc::now(),
            decided_at: None,
        })),
    }
}

pub(super) enum Execution {
    Result {
        result: WorkerResult,
        workspace: Option<PathBuf>,
        patch: Option<PathBuf>,
        worker_id: String,
        fingerprint: String,
    },
    Native {
        action: OutstandingAction,
        workspace: Option<PathBuf>,
        worker_id: String,
        fingerprint: String,
    },
    Approval(ApprovalRequest),
    Failure {
        task_id: String,
        message: String,
        workspace: Option<PathBuf>,
        worker_id: Option<String>,
        fingerprint: Option<String>,
    },
}
