use super::*;

pub(super) fn build_router(cfg: &CrewConfig) -> Result<WorkerRouter> {
    let mut workers: Vec<Arc<dyn Worker>> = Vec::new();
    for worker in cfg.workers.iter().filter(|worker| worker.enabled) {
        match worker.kind {
            WorkerKind::Cli => workers.push(Arc::new(CliWorker::from_config(
                worker,
                cfg.run.default_task_timeout_seconds,
            )?)),
            WorkerKind::Api => workers.push(Arc::new(ApiWorker::from_config(worker)?)),
            WorkerKind::Native => {}
        }
    }
    Ok(WorkerRouter::new(workers))
}

pub(super) async fn advance_run(workspace: &Path, cfg: &CrewConfig, run: &mut Run) -> Result<()> {
    let router = build_router(cfg)?;
    let scheduler = Scheduler {
        workspace_mode: cfg.run.workspace_mode,
        max_parallel_readers: cfg.run.max_parallel_readers,
        max_parallel_writers: cfg.run.max_parallel_writers,
        max_tasks_per_iteration: cfg.run.max_tasks_per_iteration,
    };

    loop {
        if matches!(
            run.status,
            RunStatus::Paused
                | RunStatus::Cancelled
                | RunStatus::AwaitingApproval
                | RunStatus::ManagerRequired
                | RunStatus::Completed
                | RunStatus::Failed
                | RunStatus::Blocked
        ) {
            break;
        }
        let graph = TaskGraph::new(run.tasks.values().cloned().collect())?;
        let batch = scheduler.next_batch(&graph);
        if batch.read_task_ids.is_empty() && batch.write_task_ids.is_empty() {
            finish_or_block(workspace, cfg, run).await?;
            break;
        }
        if run.iteration >= run.max_iterations {
            run.status = RunStatus::Failed;
            run.terminal_summary = Some("iteration limit exhausted".to_string());
            break;
        }

        run.iteration += 1;
        mark_running(run, &batch.read_task_ids);
        mark_running(run, &batch.write_task_ids);
        let run_store = store(workspace);
        run_store.save(run)?;
        for task_id in batch
            .read_task_ids
            .iter()
            .chain(batch.write_task_ids.iter())
        {
            run_store.append_event(
                &run.id,
                EventKind::TaskStarted,
                json!({ "task_id": task_id, "iteration": run.iteration }),
            )?;
        }

        let read_tasks = batch
            .read_task_ids
            .iter()
            .filter_map(|id| run.tasks.get(id).cloned())
            .collect::<Vec<_>>();
        let read_results = join_all(read_tasks.into_iter().map(|task| {
            let router_ref = &router;
            let run_ref = &*run;
            async move {
                let task_id = task.id.clone();
                (task_id, execute_task(workspace, cfg, router_ref, run_ref, &task).await)
            }
        }))
        .await;
        for (task_id, result) in read_results {
            let execution = result.unwrap_or_else(|error| Execution::Failure {
                task_id,
                message: error.to_string(),
                workspace: None,
                worker_id: None,
                fingerprint: None,
            });
            handle_execution(workspace, cfg, run, execution)?;
        }
        if matches!(
            run.status,
            RunStatus::Paused
                | RunStatus::Cancelled
                | RunStatus::AwaitingApproval
                | RunStatus::ManagerRequired
                | RunStatus::Completed
                | RunStatus::Failed
                | RunStatus::Blocked
        ) {
            store(workspace).save(run)?;
            break;
        }

        let write_tasks = batch
            .write_task_ids
            .iter()
            .filter_map(|id| run.tasks.get(id).cloned())
            .collect::<Vec<_>>();
        if cfg.run.workspace_mode == WorkspaceMode::Isolated {
            let write_results = join_all(write_tasks.into_iter().map(|task| {
                let router_ref = &router;
                let run_ref = &*run;
                async move {
                    let task_id = task.id.clone();
                    (task_id, execute_task(workspace, cfg, router_ref, run_ref, &task).await)
                }
            }))
            .await;
            for (task_id, result) in write_results {
                let execution = result.unwrap_or_else(|error| Execution::Failure {
                    task_id,
                    message: error.to_string(),
                    workspace: None,
                    worker_id: None,
                    fingerprint: None,
                });
                handle_execution(workspace, cfg, run, execution)?;
            }
        } else {
            for task in write_tasks {
                let _lock = RepositoryWriteLock::acquire(workspace, &run.id, &task.id)?;
                let execution = execute_task(workspace, cfg, &router, run, &task)
                    .await
                    .unwrap_or_else(|error| Execution::Failure {
                        task_id: task.id.clone(),
                        message: error.to_string(),
                        workspace: None,
                        worker_id: None,
                        fingerprint: None,
                    });
                handle_execution(workspace, cfg, run, execution)?;
            }
        }
        store(workspace).save(run)?;
    }
    Ok(())
}

pub(super) fn mark_running(run: &mut Run, ids: &[String]) {
    for id in ids {
        if let Some(task) = run.tasks.get_mut(id) {
            task.status = TaskStatus::Running;
        }
    }
}

pub(super) async fn finish_or_block(workspace: &Path, cfg: &CrewConfig, run: &mut Run) -> Result<()> {
    if !run
        .tasks
        .values()
        .all(|task| matches!(task.status, TaskStatus::Completed | TaskStatus::Cancelled))
    {
        run.status = RunStatus::Blocked;
        run.terminal_summary = Some("No schedulable task remains".to_string());
        return Ok(());
    }

    if cfg.verification.require_independent_review
        && !cfg.verification.allow_same_agent_review
        && !has_independent_review(run)
    {
        run.status = RunStatus::Failed;
        run.terminal_summary = Some(
            "independent review is required but no reviewer distinct from all write workers completed"
                .to_string(),
        );
        return Ok(());
    }

    if !cfg.verification.commands.is_empty() {
        match enforce_run_operation(
            cfg,
            run,
            Operation::TestCommand,
            "Configured verification commands require approval".to_string(),
        ) {
            Ok(Some(approval)) => {
                if !run.approvals.iter().any(|item| item.id == approval.id) {
                    run.approvals.push(approval.clone());
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
                return Ok(());
            }
            Ok(None) => {}
            Err(error) => {
                run.status = RunStatus::Failed;
                run.terminal_summary = Some(error.to_string());
                return Ok(());
            }
        }
    }

    run.verification = run_verification(workspace, &cfg.verification.commands).await;
    match agents_crew_core::verify_completion(run) {
        Ok(()) => {
            run.status = RunStatus::Completed;
            run.terminal_summary = Some("All tasks completed with criterion evidence".to_string());
        }
        Err(error) => {
            run.status = RunStatus::Failed;
            run.terminal_summary = Some(error.to_string());
        }
    }
    Ok(())
}

pub(super) fn has_independent_review(run: &Run) -> bool {
    let writers = run
        .tasks
        .values()
        .filter(|task| task.writes() && task.status == TaskStatus::Completed)
        .filter_map(|task| task.assigned_worker.as_deref())
        .collect::<BTreeSet<_>>();
    run.tasks.values().any(|task| {
        task.role == Role::Reviewer
            && task.status == TaskStatus::Completed
            && task
                .assigned_worker
                .as_deref()
                .is_some_and(|worker| !writers.contains(worker))
    })
}
