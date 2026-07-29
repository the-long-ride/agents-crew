use crate::RunIntent;
use agents_crew_core::{Run, RunStatus, TaskStatus};

pub(crate) fn render_goal(run: &Run, intent: &RunIntent) -> String {
    format!(
        "# Goal {}\n\n## Original prompt\n\n{}\n\n## Goal\n\n{}\n\n## Expectations\n\n{}\n\n## Acceptance criteria\n\n{}\n\n## Constraints\n\n{}\n\n## Crew\n\n- Template: `{}` ({})\n- Manager host: `{}`\n- Run ID: `{}`\n",
        run.id,
        run.original_goal,
        intent.goal,
        markdown_list(&intent.expectations),
        markdown_list(&intent.acceptance_criteria),
        markdown_list(&intent.constraints),
        intent.template_id,
        intent.template_name,
        run.manager.host,
        run.id
    )
}

pub(crate) fn render_status(run: &Run) -> String {
    let completed = run
        .tasks
        .values()
        .filter(|task| task.status == TaskStatus::Completed)
        .map(|task| format!("- [x] {} (`{}`)", task.title, task.id))
        .collect::<Vec<_>>();
    let active = run
        .tasks
        .values()
        .filter(|task| matches!(task.status, TaskStatus::Running | TaskStatus::Verifying))
        .map(|task| format!("- {} (`{}`): `{:?}`", task.title, task.id, task.status))
        .collect::<Vec<_>>();
    let remaining = run
        .tasks
        .values()
        .filter(|task| {
            matches!(
                task.status,
                TaskStatus::Pending
                    | TaskStatus::Ready
                    | TaskStatus::Retryable
                    | TaskStatus::Blocked
                    | TaskStatus::Failed
            )
        })
        .map(|task| format!("- [ ] {} (`{}`): `{:?}`", task.title, task.id, task.status))
        .collect::<Vec<_>>();
    let blockers = run
        .tasks
        .values()
        .filter_map(|task| task.result.as_ref())
        .flat_map(|result| result.blockers.iter())
        .map(|blocker| format!("- {blocker}"))
        .collect::<Vec<_>>();
    let verification = run
        .verification
        .iter()
        .map(|test| format!("- `{:?}` — {}", test.status, test.summary))
        .collect::<Vec<_>>();
    format!(
        "# Run status\n\n- Run: `{}`\n- Phase: `{:?}`\n- Iteration: `{}/{}`\n- Updated: `{}`\n\n## Completed work\n\n{}\n\n## Active work\n\n{}\n\n## Remaining work\n\n{}\n\n## Blockers\n\n{}\n\n## Trade-offs and decisions\n\n{}\n\n## Verification\n\n{}\n\n## Next manager action\n\n{}\n",
        run.id,
        run.status,
        run.iteration,
        run.max_iterations,
        run.updated_at.to_rfc3339(),
        section(&completed),
        section(&active),
        section(&remaining),
        section(&blockers),
        run.terminal_summary.as_deref().unwrap_or("No recorded trade-off."),
        section(&verification),
        next_action(run)
    )
}

pub(crate) fn render_host_instructions(run: &Run) -> String {
    format!(
        "# Durable host protocol\n\nThis directory is generated for run `{}`. Treat `run.json` as authoritative. Read `goal-{}.md` and `status.md` before each planning cycle. Record agent session IDs and normalized results under `agents/` and `artifacts/`. Do not delete or rewrite source files as part of context cleanup. Use only action IDs issued by the Rust manager.\n",
        run.id, run.id
    )
}

fn next_action(run: &Run) -> &'static str {
    match run.status {
        RunStatus::Planning => "Create or submit the bounded task plan.",
        RunStatus::Working => "Continue the next Rust-issued task action.",
        RunStatus::Paused => "Resume when the user requests continuation.",
        RunStatus::AwaitingApproval => "Wait for the exact requested approval.",
        RunStatus::ManagerRequired => "Inspect durable context and submit the requested manager decision.",
        RunStatus::Blocked => "Resolve recorded blockers before scheduling more work.",
        RunStatus::Completed => "No action remains; inspect archived history.",
        RunStatus::Failed => "Inspect failure evidence and resume only after correction.",
        RunStatus::Cancelled => "No action remains; inspect archived history.",
    }
}

fn markdown_list(items: &[String]) -> String {
    if items.is_empty() {
        "- Not specified".to_string()
    } else {
        items
            .iter()
            .map(|item| format!("- {item}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn section(items: &[String]) -> String {
    if items.is_empty() {
        "- None".to_string()
    } else {
        items.join("\n")
    }
}
