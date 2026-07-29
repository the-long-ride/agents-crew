use super::*;

pub(super) fn template_command(workspace: &Path, command: TemplateCommand) -> Result<Value> {
    let registry = TemplateRegistry::new(workspace);
    match command {
        TemplateCommand::List => Ok(serde_json::to_value(registry.list()?)?),
        TemplateCommand::Show { id } => Ok(serde_json::to_value(registry.resolve(&id)?)?),
        TemplateCommand::Validate { id } => {
            let record = registry.resolve(&id)?;
            validate(&record.config)?;
            Ok(json!({
                "valid": true,
                "id": record.id,
                "scope": record.scope,
                "workers": record.config.workers.len()
            }))
        }
        TemplateCommand::Delete { id, scope } => {
            let scope = match scope {
                TemplateScopeArg::Global => TemplateScope::Global,
                TemplateScopeArg::Workspace => TemplateScope::Workspace,
            };
            registry.delete(scope, &id)?;
            Ok(json!({ "deleted": id, "scope": scope }))
        }
    }
}

pub(super) async fn start_template(workspace: &Path, args: StartArgs) -> Result<Value> {
    let record = TemplateRegistry::new(workspace).resolve(&args.template_id)?;
    let mut run = build_default_run(workspace, &args.goal, &record.config);
    if !args.acceptance_criteria.is_empty() {
        run.acceptance_criteria = args
            .acceptance_criteria
            .iter()
            .enumerate()
            .map(|(index, description)| AcceptanceCriterion {
                id: format!("user-{}", index + 1),
                description: description.clone(),
                required_checks: record
                    .config
                    .verification
                    .commands
                    .iter()
                    .map(|command| command.join(" "))
                    .collect(),
            })
            .collect();
    }
    let intent = RunIntent {
        template_id: record.id.clone(),
        template_name: record.name.clone(),
        goal: args.goal.clone(),
        expectations: args.expectations,
        acceptance_criteria: args.acceptance_criteria,
        constraints: args.constraints,
    };
    let run_store = store(workspace);
    run_store.create(&run)?;
    RunProtocol::new(workspace).materialize(&run, &record.config, &intent)?;
    run_store.append_event(
        &run.id,
        EventKind::RunStarted,
        json!({ "goal": args.goal, "template_id": record.id, "template_scope": record.scope }),
    )?;
    advance_run(workspace, &record.config, &mut run).await?;
    persist_run(workspace, &run)?;
    run_response(workspace, &run)
}
