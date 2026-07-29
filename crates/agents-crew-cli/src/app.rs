use crate::args::*;
use agents_crew_api_workers::ApiWorker;
use agents_crew_cli_workers::CliWorker;
use agents_crew_config::{validate, CrewConfig, WorkerConfig, WorkerKind};
use agents_crew_core::{
    apply_manager_decision, create_run, record_worker_result, verify_task_result,
    AcceptanceCriterion, ApprovalRequest, ApprovalStatus, Capability, ManagerAction, ManagerCoding,
    ManagerDecision, ManagerIdentity, ModelFallback, Role, Run, RunStatus, Scheduler, Task,
    TaskDraft, TaskGraph, TaskStatus, TestResult, TestStatus, WorkerResult, WorkerResultStatus,
    WorkspaceMode,
};
use agents_crew_git::{
    canonical_scoped_path, GitRepository, RepositorySnapshot, RepositoryWriteLock,
};
use agents_crew_plugins::{Host, HostPlugin};
use agents_crew_protocol::{RunIntent, RunProtocol};
use agents_crew_templates::{TemplateRegistry, TemplateScope};
use agents_crew_policy::{Operation, PolicyContext, PolicyDecision, PolicyEngine};
use agents_crew_prompts::role;
use agents_crew_state::{EventKind, OutstandingAction, RunStore};
use agents_crew_workers::{NativeBridge, RoutingContext, Worker, WorkerRequest, WorkerRouter};
use anyhow::{anyhow, Context, Result};
use chrono::{Duration, Utc};
use futures::future::join_all;
use serde_json::{json, Value};
use std::{
    collections::{hash_map::DefaultHasher, BTreeSet},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tokio::process::Command as TokioCommand;
use uuid::Uuid;

mod admin;
mod context;
mod control;
mod engine;
mod manager;
mod native;
mod outcome;
mod policy;
mod routing;
mod setup;
mod task;
mod template;
mod ui;
mod verification;

use admin::*;
use context::*;
use control::*;
use engine::*;
use manager::*;
use native::*;
use outcome::*;
use policy::*;
use routing::*;
use setup::*;
use task::*;
use template::*;
use ui::*;
use verification::*;

#[cfg(test)]
mod tests;

pub async fn run(cli: Cli) -> Result<Value> {
    let workspace = cli.workspace.canonicalize().unwrap_or(cli.workspace);
    match cli.command {
        Command::Init(args) => init(&workspace, args),
        Command::Ui(args) => ui_command(&workspace, args).await,
        Command::Start(args) => start_template(&workspace, args).await,
        Command::Plan(args) => plan(&workspace, &args.goal.join(" ")),
        Command::Run(args) => run_goal(&workspace, &args.goal.join(" ")).await,
        Command::Status(selector) => status(&workspace, selector.selected()),
        Command::Resume(selector) => resume(&workspace, selector.selected()).await,
        Command::Pause(selector) => set_run_status(
            &workspace,
            selector.selected(),
            RunStatus::Paused,
            "paused",
        ),
        Command::Cancel(selector) => set_run_status(
            &workspace,
            selector.selected(),
            RunStatus::Cancelled,
            "cancelled",
        ),
        Command::Approve(args) => {
            decide_approval(&workspace, args.run.as_deref(), &args.approval_id, true)
        }
        Command::Reject(args) => {
            decide_approval(&workspace, args.run.as_deref(), &args.approval_id, false)
        }
        Command::Doctor => doctor(&workspace).await,
        Command::Template { command } => template_command(&workspace, command),
        Command::Config { command } => config_command(&workspace, command),
        Command::Plugin { command } => plugin_command(&workspace, command),
        Command::Worker { command } => worker_command(&workspace, command).await,
        Command::Manager { command } => manager_command(&workspace, command).await,
    }
}
