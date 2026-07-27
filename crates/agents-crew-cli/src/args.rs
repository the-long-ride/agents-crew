use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "crew",
    version,
    about = "Rust-enforced multi-agent crew orchestration"
)]
pub struct Cli {
    #[arg(long, global = true, default_value = ".")]
    pub workspace: PathBuf,
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Init(InitArgs),
    Run(GoalArgs),
    Plan(GoalArgs),
    Status(RunSelector),
    Resume(RunSelector),
    Pause(RunSelector),
    Approve(ApprovalArgs),
    Reject(ApprovalArgs),
    Cancel(RunSelector),
    Doctor,
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Plugin {
        #[command(subcommand)]
        command: PluginCommand,
    },
    Worker {
        #[command(subcommand)]
        command: WorkerCommand,
    },
    Manager {
        #[command(subcommand)]
        command: ManagerCommand,
    },
}

#[derive(Debug, Args)]
pub struct InitArgs {
    #[arg(long)]
    pub non_interactive: bool,
    #[arg(long)]
    pub force: bool,
}

#[derive(Debug, Args)]
pub struct GoalArgs {
    #[arg(required = true, num_args = 1..)]
    pub goal: Vec<String>,
}

#[derive(Debug, Args, Default)]
pub struct RunSelector {
    #[arg(long)]
    pub run: Option<String>,
}

#[derive(Debug, Args)]
pub struct ApprovalArgs {
    pub approval_id: String,
    #[arg(long)]
    pub run: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    Validate,
    Show,
}

#[derive(Debug, Subcommand)]
pub enum PluginCommand {
    List,
    Install {
        host: String,
        #[arg(long)]
        force: bool,
    },
    Doctor {
        host: String,
    },
    Uninstall {
        host: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum WorkerCommand {
    Probe,
    Run { worker: String, task: PathBuf },
}

#[derive(Debug, Subcommand)]
pub enum ManagerCommand {
    Start {
        #[arg(long, required = true)]
        goal: String,
        #[arg(long, required = true)]
        host: String,
    },
    Step {
        #[arg(long)]
        run: String,
    },
    Submit {
        #[arg(long)]
        run: String,
        #[arg(long)]
        action: String,
        #[arg(long)]
        result: PathBuf,
    },
}
