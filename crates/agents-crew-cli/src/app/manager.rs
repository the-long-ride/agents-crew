use super::*;

pub(super) async fn manager_command(workspace: &Path, command: ManagerCommand) -> Result<Value> {
    match command {
        ManagerCommand::Start { goal, host } => {
            let cfg = config(workspace)?;
            let manager = ManagerIdentity {
                host,
                coding: cfg.manager.coding,
                small_fix_max_files: cfg.manager.small_fix_max_files,
                small_fix_max_changed_lines: cfg.manager.small_fix_max_changed_lines,
            };
            let run = create_run(
                goal.clone(),
                workspace.to_path_buf(),
                cfg.run.workspace_mode,
                manager,
                cfg.run.max_iterations,
            );
            let id = run.id.clone();
            let run_store = store(workspace);
            run_store.create(&run)?;
            let action = OutstandingAction {
                id: Uuid::new_v4().to_string(),
                run_id: id.clone(),
                task_id: None,
                issued_at: Utc::now(),
                expires_at: Some(Utc::now() + Duration::hours(24)),
                capability_envelope: BTreeSet::new(),
                action: ManagerAction::Plan {
                    goal,
                    state_path: run_store.run_dir(&id).join("run.json"),
                    output_schema: workspace.join("schemas/manager-decision.schema.json"),
                },
                consumed: false,
            };
            run_store.save_action(&action)?;
            run_store.append_event(
                &id,
                EventKind::ManagerActionIssued,
                json!({ "action_id": action.id, "type": "plan" }),
            )?;
            Ok(json!({ "run_id": id, "actions": [action] }))
        }
        ManagerCommand::Step { run: run_id } => {
            let cfg = config(workspace)?;
            let run_store = store(workspace);
            let mut state = run_store.load(&run_id)?;
            if recover_interrupted_tasks(workspace, &mut state)? {
                run_store.save(&state)?;
            }
            let pending = run_store.pending_actions(&run_id)?;
            let expired = run_store.expired_actions(&run_id)?;
            if !expired.is_empty() {
                state.status = RunStatus::Blocked;
                state.terminal_summary = Some(format!(
                    "{} manager action(s) expired; inspect the workspace and start a fresh action or run",
                    expired.len()
                ));
                run_store.save(&state)?;
            } else if pending.is_empty() && state.status == RunStatus::Working {
                advance_run(workspace, &cfg, &mut state).await?;
                run_store.save(&state)?;
            }
            run_response(workspace, &state)
        }
        ManagerCommand::Submit {
            run: run_id,
            action: action_id,
            result,
        } => submit_manager_result(workspace, &run_id, &action_id, &result),
    }
}

pub(super) fn submit_manager_result(
    workspace: &Path,
    run_id: &str,
    action_id: &str,
    result_path: &Path,
) -> Result<Value> {
    let cfg = config(workspace)?;
    let run_store = store(workspace);
    let outstanding = run_store.load_action(run_id, action_id)?;
    match &outstanding.action {
        ManagerAction::Plan { .. } | ManagerAction::Review { .. } => {
            let decision: ManagerDecision = serde_json::from_slice(&fs::read(result_path)?)?;
            let mut state = run_store.load(run_id)?;
            apply_manager_decision(&mut state, decision)?;
            run_store.consume_action(run_id, action_id, &BTreeSet::new())?;
            run_store.save(&state)?;
            run_store.append_event(
                run_id,
                EventKind::ManagerActionSubmitted,
                json!({ "action_id": action_id }),
            )?;
            run_response(workspace, &state)
        }
        ManagerAction::DispatchNative { capabilities, .. } => {
            let mut result: WorkerResult = serde_json::from_slice(&fs::read(result_path)?)?;
            if result.capabilities_used.is_empty() && !capabilities.is_empty() {
                return Err(anyhow!("native result must report capabilities_used"));
            }
            let claimed_capabilities = result.capabilities_used.clone();
            result = NativeBridge::new(run_store.clone()).submit(
                run_id,
                action_id,
                result,
                &claimed_capabilities,
            )?;
            let mut state = run_store.load(run_id)?;
            if let Err(error) = integrate_native_workspace(workspace, &cfg, &mut state, &mut result) {
                mark_task_failure(workspace, &mut state, &result.task_id, &error.to_string())?;
                run_store.save(&state)?;
                return run_response(workspace, &state);
            }
            if let Some(task) = state.tasks.get_mut(&result.task_id) {
                task.status = TaskStatus::Verifying;
            }
            match record_worker_result(&mut state, result.clone()) {
                Ok(()) => {
                    state.status = RunStatus::Working;
                    run_store.append_event(
                        run_id,
                        EventKind::ManagerActionSubmitted,
                        json!({ "action_id": action_id, "task_id": result.task_id }),
                    )?;
                }
                Err(error) => {
                    mark_task_failure(workspace, &mut state, &result.task_id, &error.to_string())?;
                }
            }
            run_store.save(&state)?;
            run_response(workspace, &state)
        }
        ManagerAction::RequestApproval { .. }
        | ManagerAction::Display { .. }
        | ManagerAction::Terminal { .. } => {
            Err(anyhow!("action type cannot accept a file submission"))
        }
    }
}
